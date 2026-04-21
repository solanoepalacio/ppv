#!/usr/bin/env bash
set -euo pipefail

# Start the ppview content-unlock-service daemon against a locally running Zombienet.
# Assumes:
#   - the parachain is reachable at ws://127.0.0.1:${STACK_SUBSTRATE_RPC_PORT}
#     (9944 by default; shifted by STACK_PORT_OFFSET, see scripts/common.sh);
#   - keys/svc_priv.pem and keys/svc_signer.suri exist (run scripts/gen-service-key.sh first);
#   - the genesis preset binds ServiceAccountId to the sr25519 pubkey derived
#     from keys/svc_signer.suri — see blockchain/runtime/src/genesis_config_presets.rs.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=./common.sh
source "$SCRIPT_DIR/common.sh"

RPC_URL="${PPVIEW_RPC_URL:-ws://127.0.0.1:${STACK_SUBSTRATE_RPC_PORT}}"
SVC_PRIV="${PPVIEW_SVC_PRIV:-$ROOT_DIR/keys/svc_priv.pem}"
SIGNER_PATH="${PPVIEW_SERVICE_SIGNER:-$ROOT_DIR/keys/svc_signer.suri}"
LOG_FILTER="${PPVIEW_LOG:-info}"

if [ ! -f "$SVC_PRIV" ]; then
  echo "error: $SVC_PRIV not found — run scripts/gen-service-key.sh first." >&2
  exit 1
fi

# Inline SURI override bypasses the signer file. Useful for ad-hoc tests with a
# known keyring account (e.g. PPVIEW_SERVICE_SURI=//Dave). Default is the
# on-disk signer so behaviour matches the genesis binding.
SIGNER_ARGS=()
if [ -n "${PPVIEW_SERVICE_SURI:-}" ]; then
  SIGNER_ARGS+=(--service-suri "$PPVIEW_SERVICE_SURI")
  echo "Starting ppview-content-unlock-service against $RPC_URL (signer=<inline SURI>)..."
else
  if [ ! -f "$SIGNER_PATH" ]; then
    echo "error: $SIGNER_PATH not found — run scripts/gen-service-key.sh first (or set PPVIEW_SERVICE_SURI)." >&2
    exit 1
  fi
  SIGNER_ARGS+=(--service-signer-path "$SIGNER_PATH")
  echo "Starting ppview-content-unlock-service against $RPC_URL (signer=$SIGNER_PATH)..."
fi

exec cargo run --release -p ppview-content-unlock-service -- \
  --rpc-url "$RPC_URL" \
  --svc-priv-path "$SVC_PRIV" \
  "${SIGNER_ARGS[@]}" \
  --log "$LOG_FILTER"
