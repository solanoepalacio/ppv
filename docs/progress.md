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
- [ ] Task 10: purchase validation — no double purchase
- [ ] Task 11: purchase validation — insufficient funds
- [ ] Task 12: purchase validation — listing-not-found test
- [ ] Task 13: Benchmarks for create_listing + purchase
- [ ] Task 14: Wire Currency into runtime Config impl
- [ ] Task 15: Release build + WASM artifact
- [ ] Task 16: Zombienet E2E smoke script

### P1b — Frontend MVP

Plan: _not written yet_

### P1c — Deploy (IPFS + DotNS)

Plan: _not written yet_

## Phase 2 — Content encryption

Plans: _not written yet_
