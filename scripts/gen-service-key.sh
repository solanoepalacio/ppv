#!/usr/bin/env bash
set -euo pipefail

# Generate the chain-service x25519 keypair (SVC_PRIV / SVC_PUB).
#
# SVC_PRIV lives in <repo>/keys (gitignored) and is read at runtime by the
# chain-service daemon. SVC_PUB is the 32-byte x25519 public key that must be
# baked into the chain-spec via genesis so creators can seal content-lock-keys
# against it. See docs/design/spec.md §5 for the full key model.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$ROOT_DIR/keys"
PRESET_FILE="blockchain/runtime/src/genesis_config_presets.rs"

PRIV_PEM="$KEYS_DIR/svc_priv.pem"
PUB_PEM="$KEYS_DIR/svc_pub.pem"
PUB_RAW="$KEYS_DIR/svc_pub.bin"

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

openssl genpkey -algorithm X25519 -out "$PRIV_PEM" 2>/dev/null
chmod 600 "$PRIV_PEM"
openssl pkey -in "$PRIV_PEM" -pubout -out "$PUB_PEM"

# X25519 SPKI DER is 44 bytes: 12-byte algorithm header + 32-byte raw pubkey.
openssl pkey -in "$PRIV_PEM" -pubout -outform DER | tail -c 32 > "$PUB_RAW"
chmod 600 "$PUB_RAW"

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

Service x25519 keypair written to $KEYS_DIR:
  - svc_priv.pem  (chain-service private key — keep secret, chmod 600)
  - svc_pub.pem   (PEM-encoded public key)
  - svc_pub.bin   (raw 32-byte public key)

Public key (hex): 0x$HEX

To publish this pubkey in the chain's genesis, edit:

  $PRESET_FILE

and replace the SERVICE_PUBLIC_KEY constant with:

const SERVICE_PUBLIC_KEY: [u8; 32] = [
${TAB}$(format_row "$ROW1_HEX")
${TAB}$(format_row "$ROW2_HEX")
];

Then rebuild the runtime so the new key is baked into the chain-spec:

  cargo build -p ppview-runtime --release
EOF
