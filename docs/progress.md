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
- [ ] Task 19: Zombienet E2E smoke script

### P1b — Frontend MVP

Plan: [`docs/plans/P1b-frontend.md`](./plans/P1b-frontend.md)

- [ ] Task 1: Install @parity/bulletin-sdk + Vitest + regenerate PAPI descriptors
- [ ] Task 2: Utility functions — bulletinCid + contentHash (TDD)
- [ ] Task 3: Store refactor + useParachainProvider (Triangle/dev detection)
- [ ] Task 4: App shell — nav, routes, account pill
- [ ] Task 5: useContentRegistry PAPI hook
- [ ] Task 6: useBulletinUpload (bulletin-sdk + IPFS fetch)
- [ ] Task 7: Browse page + ListingCard + SkeletonCard
- [ ] Task 8: VideoPlayer component (IPFS fetch + blake2b integrity)
- [ ] Task 9: Listing Detail page (all states)
- [ ] Task 10: Create page — video/thumbnail pickers + metadata form
- [ ] Task 11: Create page — upload/submit flow + CreateChecklist
- [ ] Task 12: My Purchases page
- [ ] Task 13: TypeScript check + dev-server smoke test against Zombienet

### P1c — Deploy (IPFS + DotNS)

Plan: _not written yet_

## Phase 2 — Content encryption

Plans: _not written yet_
