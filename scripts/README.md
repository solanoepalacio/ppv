# Scripts

This directory contains convenience scripts for the main local development, testing, and deployment flows in this repo.

All scripts resolve the repo root automatically, so you can run them from the repo root with:

```bash
./scripts/<script-name>.sh
```

`start-all.sh` is the recommended full local path when you want the chain, eth-rpc, and the frontend working together.

The local startup scripts coordinate the chain, `eth-rpc`, PAPI refresh, and frontend from shared environment variables.

By default they use:

- Substrate RPC: `ws://127.0.0.1:9944`
- Ethereum RPC: `http://127.0.0.1:8545`
- Frontend: `http://127.0.0.1:5173`

To move a second local stack together, prefer:

```bash
STACK_PORT_OFFSET=100 ./scripts/start-all.sh
```

You can also override individual ports with `STACK_SUBSTRATE_RPC_PORT`, `STACK_ETH_RPC_PORT`, and `STACK_FRONTEND_PORT`.

When you use an offset or explicit port overrides, the frontend dev server and PAPI refresh follow the active port settings automatically.

## Script Guide

| Script | What it does | When to use it |
| --- | --- | --- |
| `start-dev.sh` | Builds the runtime, generates `blockchain/chain_spec.json`, and starts a single local omni-node on the resolved Substrate RPC port using dev sealing. | Use this when you only need the fastest local pallet/runtime loop. On stable2512-3, this mode does not expose Statement Store RPCs. |
| `start-local.sh` | Builds the runtime, regenerates `blockchain/chain_spec.json`, and starts the relay-backed Zombienet network using a temp config generated from the current port settings. | Use this when you want the relay-backed network directly, without eth-rpc or the frontend. |
| `start-all.sh` | Runs the full local stack through Zombienet: runtime build, chain-spec generation, relay chain + parachain startup (Statement Store-ready), `eth-rpc`, and the frontend. | Use this when you want the one-command setup for end-to-end work. |
| `start-content-unlock-service.sh` | Runs the `ppview-content-unlock-service` daemon against the local Zombienet chain, loading `keys/svc_priv.pem` and signing `grant_access` with the SURI in `keys/svc_signer.suri` (or `PPVIEW_SERVICE_SURI` if set). | Use this after `scripts/start-all.sh` so Phase 2 `WrappedKeys` entries land automatically. |
| `start-frontend.sh` | Installs frontend dependencies, refreshes PAPI descriptors if a local node is running on the resolved Substrate RPC port, and starts the Vite dev server on the resolved frontend port. | Use this when the chain is already running and you only want to work on the web app. |
| `deploy-frontend.sh` | Builds the frontend and uploads `web/dist` to IPFS using the `w3` CLI, then prints the CID and suggested DotNS follow-up steps. | Use this when you want to publish the frontend as a static deployment. |
| `gen-service-key.sh` | Generates the content-unlock-service x25519 keypair under `<repo>/keys` (gitignored), then prints instructions showing where in `genesis_config_presets.rs` to paste the public key so it gets baked into the chain-spec. | Run this once before your first local chain boot, and again whenever you need to rotate the dev service keypair. The matching private key stays in `keys/svc_priv.pem` for the content-unlock-service daemon (Phase 2b) to read. |

## Notes

- `start-dev.sh` depends on local Rust and node tooling such as `cargo`, `chain-spec-builder`, and `polkadot-omni-node`.
- `start-all.sh` and `start-local.sh` require both `polkadot` and `zombienet`.
- `start-all.sh` also requires `eth-rpc`.
- `deploy-frontend.sh` requires the `w3` CLI from Web3.Storage.
- `gen-service-key.sh` requires `openssl` (x25519 via `openssl genpkey`).
