# Polkadot Stack Template — research notes for ppview

> Source: `github.com/paritytech/polkadot-stack-template`
> Research date: 2026-04-17.

The template's example domain is **Proof of Existence (PoE)**: drop a file, hash with blake2b-256, claim the hash on-chain (pallet OR Solidity contract via pallet-revive), optionally upload bytes to Bulletin Chain or submit to Statement Store. Same concept, three implementations, side-by-side.

Versions: polkadot-sdk `stable2512-3`, PAPI `1.23.3`, React 18.3, Node 22, Rust stable. Uses the new `frame` umbrella crate (`polkadot-sdk-frame`).

---

## 1. FRAME pallet — `pallet-template` (PoE)

- **What:** Minimal FRAME pallet with two extrinsics (`create_claim`, `revoke_claim`) and one `StorageMap`.
- **Files:** `blockchain/pallets/template/src/lib.rs` (~125 lines), `Cargo.toml`, `mock.rs`, `tests.rs` (9 unit tests), `weights.rs`, `benchmarking.rs`.
- **Demonstrates:** Pallet structure with `#[frame::pallet]`, `StorageMap<H256, Claim<T>, OptionQuery>`, custom struct stored on-chain, events, errors, weight annotations, full unit-test scaffolding with mock runtime.
- **Lift for ppview:** Closest fit for **Phase 1 content registry**. Replace `Claim<T>` with `Listing<T>` (creator, price, content CID, preview CID, metadata) and add a second StorageMap `Purchases: (ContentId, Buyer) → BlockNumber`. Add a `purchase` extrinsic doing `T::Currency::transfer` to creator + recording purchase. `mock.rs` + `tests.rs` pattern is reusable as-is. For Phase 2 add `WrappedKeys: (ContentId, Buyer) → Vec<u8>` and a key-deposit extrinsic.

## 2. Parachain runtime

- **What:** Cumulus parachain runtime targeting `polkadot-omni-node`.
- **Files:** `blockchain/runtime/src/lib.rs` (construct_runtime + runtime APIs), `blockchain/runtime/src/configs/mod.rs` (every pallet `Config` impl), `genesis_config_presets.rs` (Sr25519 dev keys + Ethereum dev accounts), `blockchain/zombienet.toml` (rococo-local + 1 collator), `blockchain/chain_spec.json` (pre-generated).
- **Demonstrates:** Parachain wiring with Aura + collator-selection + XCM + parachain-system + Sudo, `pallet-statement` integration with cost params, `pallet-revive` for EVM/PVM, `pallet-template` at index 50.
- **Lift for ppview:** Use as starting point. Template is **parachain-shaped (Cumulus)**, not a solochain. Easiest path for Phase 1-2 local dev: keep the parachain shape, run via Zombienet (`start-local.sh`). Swap `pallet-template` for our pallet. For **Phase 3 on Paseo**, drop `pallet-revive`, EVM dev accounts, and possibly `pallet-statement` if unused. `Sudo` is wired in — useful for dev funding via the Accounts page.

## 3. CLI — `stack-cli`

- **What:** Rust CLI using subxt + alloy.
- **Files:** `cli/src/main.rs`, `cli/src/commands/{chain,pallet,contract,prove,mod}.rs`. The `mod.rs` is the gold mine: shared helpers for hashing, signer resolution (dev/mnemonic/seed), Bulletin upload, Statement Store submit, JSON-RPC plumbing.
- **Demonstrates:** subxt dynamic tx/storage, alloy contract calls via eth-rpc, hashing files, signer flexibility, one-shot `prove` command (hash file → optional Bulletin → optional Statement Store → on-chain claim).
- **Lift for ppview:** Probably not lifted directly, but `cli/src/commands/mod.rs` is a great reference for any Rust scripting (e.g. seeding listings during dev). `resolve_substrate_signer` and `upload_to_bulletin` patterns are useful.

## 4. React + PAPI frontend

- **What:** Vite + React 18 + TS + Tailwind + zustand, PAPI as chain client.
- **Files:**
  - `web/src/App.tsx`, `main.tsx` — router + layout
  - `web/src/hooks/useChain.ts` — singleton `PolkadotClient` with `withPolkadotSdkCompat` + `getWsProvider`
  - `web/src/hooks/useConnection.ts` — connect/disconnect lifecycle, pallet feature detection
  - `web/src/hooks/useAccount.ts` — dev keypair derivation via `@polkadot-labs/hdkd` (Alice/Bob/Charlie from `DEV_PHRASE`), produces a `PolkadotSigner`
  - `web/src/store/chainStore.ts` — zustand store
  - `web/src/config/network.ts` — local-vs-testnet endpoint selection, localStorage overrides, env defaults
  - `web/src/utils/{hash,cid,format}.ts` — blake2b-256 file hashing, hex→CID conversion (CIDv1 + raw codec 0x55 + blake2b-256 multihash 0xb220), dispatch error formatter
  - `web/src/components/FileDropZone.tsx` — drag-drop + hashing UI
  - `web/src/pages/PalletPage.tsx` — pallet PoE flow
  - `web/.papi/` — committed PAPI descriptors for `stack_template` and `bulletin` (regenerated via `npm run codegen`)
  - `web/.env.example` — VITE_* env vars
- **Demonstrates:** Idiomatic PAPI: `client.getTypedApi(descriptor)`, `api.query.Foo.Bar.getEntries()`, `api.tx.Foo.bar({...}).signAndSubmit(signer)`, finalized-block subscription.
- **Lift for ppview:** **The** scaffold to clone. Lift `useChain.ts`, `useConnection.ts`, `useAccount.ts`, `chainStore.ts`, `network.ts`, `utils/hash.ts`, `utils/cid.ts`, `utils/format.ts`, and `FileDropZone.tsx` nearly verbatim. `PalletPage.tsx` is a near-template for ppview's content-listing/purchase pages. The PAPI descriptor codegen workflow (`npm run codegen` reading `.papi/polkadot-api.json`) is what we'll use against our own runtime.

## 5. Bulletin Chain client

- **What:** Direct PAPI client against `wss://paseo-bulletin-rpc.polkadot.io` using a separate descriptor.
- **Files:** `web/src/hooks/useBulletin.ts` (~80 lines), Rust equivalent in `cli/src/commands/mod.rs::upload_to_bulletin`. CID derivation in `web/src/utils/cid.ts`.
- **Demonstrates:** `TransactionStorage.Authorizations` storage query for pre-flight auth check, `TransactionStorage.store({ data: Binary.fromBytes(bytes) })` upload, 8 MiB file-size limit, IPFS gateway URL construction (`https://paseo-ipfs.polkadot.io/ipfs/{cid}`), HEAD request to check IPFS availability. **Critical:** the IPFS CID is derived deterministically from the blake2b-256 hash, so we know the CID before upload. Auth must be obtained out-of-band via the Bulletin Chain web UI on Paseo.
- **Lift for ppview:** Lift `useBulletin.ts` and `utils/cid.ts` directly. The `checkBulletinAuthorization` → `uploadToBulletin` → store CID flow is exactly Phase 1's content-publish flow. Need to handle authorization UX and the ~7-day data expiry (renewal via `TransactionStorage.renew`, or accept re-upload).

## 6. Statement Store client

- **What:** Direct JSON-RPC HTTP calls (`statement_submit`, `statement_dump`) with hand-rolled SCALE encoding/decoding for `sp_statement_store::Statement`.
- **Files:** `web/src/hooks/useStatementStore.ts` (~300 lines), runtime config in `blockchain/runtime/src/configs/mod.rs`, CLI version in `cli/src/commands/mod.rs::submit_to_statement_store`, smoke test in `scripts/test-statement-store-smoke.sh`.
- **Demonstrates:** Building a signed statement with sr25519 proof, submitting via raw JSON-RPC POST, dumping and decoding fields client-side (auth proof, data, topics, decryption-key field, priority, channel). File-type sniffing for downloads. Browser↔node directly; no PAPI involved.
- **Lift for ppview:** Lift `useStatementStore.ts` if we want browser↔phone messaging via Statement Store. Hand-rolled encoder sized at 1 MiB minus 1. **Important caveat:** in `stable2512-3`, Statement Store RPCs are **only available on the relay-backed Zombienet path** (`start-all.sh` / `start-local.sh`), NOT `start-dev.sh` solo-node mode. The `@novasamatech/statement-store` SDK (per polkadot-skills) is a higher-level alternative — worth comparing first. The `decryption_key` field exists in the protocol (decoded) but template provides **no encryption helpers** to populate it.

## 7. Account / wallet management — `AccountsPage.tsx`

- **What:** Three account sources unified: dev keypairs (sr25519 hdkd), browser extensions (Polkadot.js / Talisman / SubWallet via `polkadot-api/pjs-signer`), and Polkadot Host accounts via Spektr (`@novasamatech/product-sdk`).
- **Files:** `web/src/pages/AccountsPage.tsx`, `web/src/config/evm.ts`, `web/src/hooks/useAccount.ts`.
- **Demonstrates:** Three-way host detection (`__HOST_WEBVIEW_MARK__` → desktop, `window !== window.top` → web-iframe, else standalone), Spektr extension injection retry loop, `getInjectedExtensions()` discovery, account subscription, SS58↔H160 conversion, sudo-based dev account funding.
- **Lift for ppview:** This is **the** Polkadot Triangle / sandboxed-frontend integration pattern. Lift the Spektr/host detection logic for our Triangle frontend. Dev-account funding via `Sudo.sudo(Balances.force_set_balance(...))` is handy. Evaluate `polkadot-skills:polkadot-triangle` skill for the most current approach before adopting.

## 8. Smart contracts (EVM + PVM via pallet-revive)

- **Files:** `contracts/{evm,pvm}/`, `web/src/components/ContractProofOfExistencePage.tsx`, `web/src/config/{evm,deployments}.ts`.
- **Lift for ppview:** **Skip entirely.** ppview is pallet-only; no Solidity. The `eth-rpc` adapter, viem, alloy in CLI, and entire `contracts/` tree are unused.

## 9. Local-dev scripts

- **Files:** `scripts/{start-dev,start-local,start-all,start-frontend,deploy-paseo,deploy-frontend,test-zombienet,test-statement-store-smoke}.sh`, `scripts/common.sh`, `scripts/README.md`. Plus `docker-compose.yml` with `docker/Dockerfile.{node,eth-rpc}`.
- **Demonstrates:** `start-dev.sh` = fastest single-node loop (**no Statement Store**). `start-local.sh` = relay-backed Zombienet (has Statement Store). `start-all.sh` = all-in-one (Zombienet + eth-rpc + contracts + frontend). Port-offset support for parallel stacks.
- **Lift for ppview:** For ppview — since Triangle requires Statement Store — we'll likely live on `start-local.sh` (Zombienet), not `start-dev.sh`. Lift `start-frontend.sh` and `common.sh` as-is. Skip eth-rpc and contract deploys.

## 10. Deployment — DotNS + IPFS

- **Files:** `scripts/deploy-frontend.sh` (uses `w3` CLI from web3.storage to upload `web/dist`, prints CID + DotNS follow-up), `.github/workflows/deploy-frontend.yml` (CI: `paritytech/dotns-sdk` reusable workflow, registers `.dot` domain pointing at the IPFS CID, with optional `DOTNS_MNEMONIC` secret — defaults to Alice on Paseo).
- **Demonstrates:** End-to-end "build static frontend → IPFS → register DotNS → live at `<basename>.dot`".
- **Lift for ppview:** Lift the GH Actions workflow nearly verbatim. DotNS basename rules: lowercase, 9+ letters + 2 digits — pick a name early. **Caveat:** template uploads to w3.storage IPFS, not Bulletin Chain. ppview spec says Bulletin-hosted frontend — we'd need separate logic to upload `dist/` to Bulletin (probably chunked, using `useBulletin` patterns; `polkadot-skills:bulletin-sdk` likely has helpers).

## 11. Tests / E2E harness

- **Files:** `blockchain/pallets/template/src/{mock,tests}.rs` (FRAME unit tests), `cli/src/commands/*` (inline unit tests), `scripts/test-zombienet.sh` (E2E: spawn Zombienet, deploy contracts, run CLI flows, verify state across pallet + EVM + PVM + Statement Store), `scripts/test-statement-store-smoke.sh` (focused Statement Store sanity test).
- **CI:** `.github/workflows/{ci-rust,ci-evm,ci-pvm,ci-web}.yml`.
- **Lift for ppview:** Use `mock.rs` + `tests.rs` patterns for our pallet. Bash E2E pattern is OK but `polkadot-skills:host-api-test-sdk` (Playwright) is probably a better fit for a Triangle frontend.

---

## Notable absences for ppview

- **No payment / Currency transfer extrinsic example** — PoE has no monetary flow; we'll need standard FRAME `pallet_balances` patterns for the `purchase` extrinsic.
- **No encryption helpers** — Phase 2's "wrap symmetric key with buyer's pubkey" not represented anywhere. The Statement Store decoder acknowledges a `decryption_key` field exists but doesn't populate or use it. We'll need to bring our own crypto (x25519 + ChaCha20-Poly1305 or similar).
- **No Asset Hub / pallet-assets / XCM application code** — Phase 3's USDC/USDT payments not demonstrated. Runtime has XCM plumbing for messaging but no asset transfer flow.
- **No content-encryption-at-rest or key-wrapping pallet**.
- **No mobile / phone signing flow end-to-end** — `useStatementStore.ts` writes to local node, but the Statement-Store-as-mobile-signing-relay pattern isn't shown.
- **No Bulletin Chain renewal call** in the JS code (CLI mentions `TransactionStorage.renew` exists but no example).
- **Frontend hosting on Bulletin Chain** is not demonstrated — deploy script uses w3.storage IPFS; ppview wants Bulletin instead.

## Notable extras to ignore

- All of `contracts/`, `cli/src/commands/contract.rs`, EVM-related runtime parts (`pallet-revive`, `eth-rpc`, `EthExtraImpl`, EVM dev accounts), `web/src/components/ContractProofOfExistencePage.tsx`, `web/src/config/{evm,deployments}.ts`, `web/src/pages/{Evm,Pvm}ContractPage.tsx`, `docker/Dockerfile.eth-rpc`, the eth-rpc service in `docker-compose.yml`, `scripts/deploy-paseo.sh`.
- `viem` and `alloy` deps removable from `web/package.json` and `cli/Cargo.toml`.
- The `revive` pallet check in `useConnection.ts` and the `EVM PoE` / `PVM PoE` nav items in `App.tsx` should be deleted.

---

## Top pieces to lift first (priority order)

1. **`pallet-template`** — entire pallet structure (`blockchain/pallets/template/`) as the basis for the content-registry pallet; reuse the `mock.rs` + `tests.rs` testing pattern verbatim.
2. **Frontend hooks/utils** — `web/src/hooks/{useChain,useConnection,useAccount}.ts`, `web/src/store/chainStore.ts`, `web/src/config/network.ts`, `web/src/utils/{hash,cid,format}.ts`, `web/src/components/FileDropZone.tsx`. PAPI codegen workflow + `web/.papi/polkadot-api.json` config.
3. **Bulletin Chain integration** — `web/src/hooks/useBulletin.ts` + `web/src/utils/cid.ts` (deterministic blake2b→CID is a key insight).
4. **Spektr / host detection** in `web/src/pages/AccountsPage.tsx` — the Polkadot Triangle integration pattern.
5. **DotNS deploy workflow** — `.github/workflows/deploy-frontend.yml`.

## Surprises to know about

- Zero crypto helpers despite the Statement Store protocol having a `decryption_key` field — Phase 2 is fully greenfield.
- No payment/Currency example — Phase 1's `purchase` extrinsic is net-new (not based on PoE).
- Statement Store RPCs require the Zombienet path on `stable2512-3`, not the fast solo-node loop — affects local dev velocity.
- Frontend deployment goes to w3.storage IPFS, not Bulletin Chain — spec wants Bulletin hosting, no example exists.
- Template is parachain-shaped (Cumulus). "Own solochain locally" means either Zombienet (parachain mode, slower startup) or a runtime restructure.
