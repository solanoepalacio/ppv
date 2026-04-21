# Project Progress Tracking

Source of truth for plan execution. Mark a task `[x]` only after user validation.

## Phase 1 — MVP

### P1a — Pallet + Runtime

Plan: [`docs/plans/P1a-pallet-runtime.md`](./plans/P1a-pallet-runtime.md) · Overview: [`docs/plans/P1a-overview.md`](./plans/P1a-overview.md)

- [x] Task 1: Rename pallet-template → pallet-content-registry
- [x] Task 2: Strip PoE, add Currency to Config, wire balances into mock
- [x] Task 3: Add BulletinCid type
- [x] Task 4: Add Listing struct + NextListingId + Listings storage
- [x] Task 5: create_listing extrinsic (happy path)
- [x] Task 6: create_listing validation — price > 0
- [x] Task 7: Add Purchases storage map
- [x] Task 8: purchase extrinsic (happy path)
- [x] Task 9: purchase validation — buyer ≠ creator
- [x] Task 10: purchase validation — no double purchase
- [x] Task 11: purchase validation — insufficient funds
- [x] Task 12: purchase validation — listing-not-found test
- [x] Task 13: Benchmarks for create_listing + purchase
- [x] Task 14: Wire Currency into runtime Config impl
- [x] Task 15: Add thumbnail_cid to Listing + create_listing
- [x] Task 16: Flip Purchases to StorageDoubleMap<AccountId, ListingId, BlockNumberFor<T>> + sync spec
- [x] Task 17: Clean up template leftovers + register pallet benchmarks in runtime
- [x] Task 18: Release build + WASM artifact
- [x] Task 19: Zombienet E2E smoke script

### P1b — Frontend MVP

Plan: [`docs/plans/P1b-frontend.md`](./plans/P1b-frontend.md)

- [x] Task 1: Install @parity/bulletin-sdk + Vitest + regenerate PAPI descriptors
- [x] Task 2: Utility functions — bulletinCid + contentHash (TDD)
- [x] Task 3: Store refactor + useParachainProvider (Triangle/dev detection)
- [x] Task 4: App shell — nav, routes, account pill
- [x] Task 5: useContentRegistry PAPI hook
- [x] Task 6: useBulletinUpload (bulletin-sdk + IPFS fetch)
- [x] Task 7: Browse page + ListingCard + SkeletonCard
- [x] Task 8: VideoPlayer component (IPFS fetch + blake2b integrity)
- [x] Task 9: Listing Detail page (all states)
- [x] Task 10: Create page — video/thumbnail pickers + metadata form
- [x] Task 11: Create page — upload/submit flow + CreateChecklist
- [x] Task 12: My Purchases page
- [x] Task 13: Spec §5.1 + §6 — two-signer account model
- [x] Task 14: Dev accounts — pin one user account, expose Alice separately (TDD)
- [x] Task 15: Split parachain provider into user + Alice signers (TDD)
- [x] Task 16: Bulletin upload — Alice signs authorization, user signs store; skip re-auth when quota suffices (TDD)
- [x] Task 17: Top-bar empty-state copy for host-mode pairing prompt
- [x] Task 18: E2E verification on Zombienet — user signs parachain + store, Alice signs only authorization
- [x] Task 19: TypeScript check + dev-server smoke test against Zombienet

## Phase 2 — Content encryption

### P2a — Pallet + Runtime

Plan: [`docs/plans/P2a-pallet-runtime.md`](./plans/P2a-pallet-runtime.md)

- [x] Task 1: Lock locked_content_lock_key to [u8; 80]
- [x] Task 2: ServicePublicKey + ServiceAccountId storage + GenesisConfig
- [x] Task 3: integrity_test guard
- [x] Task 4: ServiceOrigin Config item + mock binding
- [x] Task 5: EncryptionKeys + register_encryption_key
- [x] Task 6: WrappedKeys + grant_access (ServiceOrigin, Pays::No)
- [x] Task 7: Benchmarks for new extrinsics
- [x] Task 8: EnsureServiceAccount runtime wiring
- [x] Task 9: Genesis presets populate ContentRegistryConfig
- [x] Task 10: Release build + Zombienet launch smoke

### P2b — Chain-service daemon

Plan: [`docs/plans/P2b-chain-service.md`](./plans/P2b-chain-service.md)

- [x] Task 1: Scaffold chain-service crate + workspace wiring
- [x] Task 2: Load SVC_PRIV from PKCS#8 PEM
- [x] Task 3: NaCl sealed-box seal/unseal (80-byte wire format)
- [x] Task 4: Chain facade — readers + grant_access submission
- [x] Task 5: wrap_and_grant handler (idempotent)
- [x] Task 6: Finalized event stream (PurchaseCompleted + ListingCreated)
- [x] Task 7: Startup reconciliation over Listings + Purchases
- [x] Task 8: Main loop — backfill + live stream + SIGINT
- [ ] Task 9: start-chain-service.sh helper + crate README
- [ ] Task 10: Zombienet E2E — daemon grants access on purchase

### P2c — Frontend encryption flow

Plan: _not written yet_

## Phase 3:
_not written yet_

## Phase 4:
_not writen yet_

## Phase 5
_not written yet_
