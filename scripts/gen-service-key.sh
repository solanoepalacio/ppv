#!/usr/bin/env bash
set -euo pipefail

# Generate the content-unlock-service keys (x25519 SVC_PRIV/SVC_PUB + sr25519 service
# signer SURI).
#
# Everything lives in <repo>/keys (gitignored) and is read at runtime by the
# content-unlock-service daemon. The public parts (SVC_PUB bytes, sr25519 AccountId
# bytes) must be baked into the chain-spec via genesis so the pallet accepts
# grant_access from the daemon and creators can seal content-lock-keys
# against SVC_PUB. See docs/design/spec.md §5 for the full key model.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$ROOT_DIR/keys"
PRESET_FILE="blockchain/runtime/src/genesis_config_presets.rs"

PRIV_PEM="$KEYS_DIR/svc_priv.pem"
PUB_PEM="$KEYS_DIR/svc_pub.pem"
PUB_RAW="$KEYS_DIR/svc_pub.bin"
SIGNER_SURI="$KEYS_DIR/svc_signer.suri"

command -v openssl >/dev/null 2>&1 || {
  echo "error: openssl is required" >&2
  exit 1
}

mkdir -p "$KEYS_DIR"
chmod 700 "$KEYS_DIR"

if [ -e "$PRIV_PEM" ]; then
  echo "error: $PRIV_PEM already exists — delete it if you really want to regenerate." >&2
  exit 1
fi
if [ -e "$SIGNER_SURI" ]; then
  echo "error: $SIGNER_SURI already exists — delete it if you really want to regenerate." >&2
  exit 1
fi

openssl genpkey -algorithm X25519 -out "$PRIV_PEM" 2>/dev/null
chmod 600 "$PRIV_PEM"
openssl pkey -in "$PRIV_PEM" -pubout -out "$PUB_PEM"

# X25519 SPKI DER is 44 bytes: 12-byte algorithm header + 32-byte raw pubkey.
openssl pkey -in "$PRIV_PEM" -pubout -outform DER | tail -c 32 > "$PUB_RAW"
chmod 600 "$PUB_RAW"

# sr25519 service signer: a raw 32-byte seed stored as a `0x<hex>` SURI.
# subxt-signer's SecretUri::from_str and @polkadot-labs/hdkd both accept this
# format directly; no mnemonic is involved.
(umask 077 && printf '0x%s' "$(openssl rand -hex 32)" > "$SIGNER_SURI")
chmod 600 "$SIGNER_SURI"

HEX="$(od -An -tx1 -v "$PUB_RAW" | tr -d ' \n')"

format_row() {
  local row="$1"
  local out=""
  local i
  for ((i = 0; i < ${#row}; i += 2)); do
    out+="0x${row:$i:2}, "
  done
  printf '%s' "${out% }"
}

ROW1_HEX="${HEX:0:32}"
ROW2_HEX="${HEX:32:32}"
TAB=$'\t'

cat <<EOF

Service keys written to $KEYS_DIR:
  - svc_priv.pem     (x25519 private key — content-unlock-service SVC_PRIV, chmod 600)
  - svc_pub.pem      (PEM-encoded x25519 public key)
  - svc_pub.bin      (raw 32-byte x25519 public key)
  - svc_signer.suri  (sr25519 service-signer SURI — content-unlock-service signer, chmod 600)

x25519 public key (hex): 0x$HEX

To publish both public parts in the chain's genesis, edit:

  $PRESET_FILE

1) Replace the SERVICE_PUBLIC_KEY constant with:

const SERVICE_PUBLIC_KEY: [u8; 32] = [
${TAB}$(format_row "$ROW1_HEX")
${TAB}$(format_row "$ROW2_HEX")
];

2) Derive the sr25519 AccountId bytes and replace SERVICE_ACCOUNT_ID. Run:

  cargo run -p ppview-content-unlock-service -- print-service-account

and paste its output block into the preset.

3) Rebuild the runtime so both keys are baked into the chain-spec:

  cargo build -p ppview-runtime --release
EOF
