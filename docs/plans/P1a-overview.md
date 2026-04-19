# P1a — Pallet + Runtime: high-level task overview

One-page review of what each task in `P1a-pallet-runtime.md` is expected to deliver. For the full step-by-step breakdown (code, test names, commit messages), see the main plan.

**Plan goal:** a content-registry FRAME pallet wired into the parachain runtime, end-to-end exercised under Zombienet with subxt.

**Intermediate invariant:** at the end of every task, `cargo check -p pallet-content-registry` and `cargo check -p ppview-runtime --features std` must both pass. Later tasks strengthen this (tests pass, release build, E2E smoke).

---

## Task 1 — Rename `pallet-template` → `pallet-content-registry`

**Mechanical rename only — no logic changes.** After this task, PoE (proof-of-existence) code is still in `src/lib.rs`, `src/benchmarking.rs`, `src/tests.rs`; it's just living under the new crate name. The runtime builds, but the pallet doesn't do anything useful for ppview yet.

- Files renamed: `blockchain/pallets/template/` → `blockchain/pallets/content-registry/`.
- Refs updated: workspace `Cargo.toml`, pallet `Cargo.toml`, runtime `Cargo.toml`, runtime `lib.rs` (`TemplatePallet` → `ContentRegistry`), runtime `configs/mod.rs` (Config impl rename).
- **Done when:** both `cargo check`s pass and the commit diff is renames + reference updates only.

---

## Task 2 — Strip PoE, add `Currency` to `Config`, wire balances into mock

First real logic change. All PoE code (`Claim<T>`, `create_claim`, `revoke_claim`, PoE tests) is deleted. The pallet is reduced to an empty scaffold: `Config` declares `type Currency` and `type WeightInfo`; the module has empty `Event`, `Error`, and `Call` blocks. `weights.rs` and `benchmarking.rs` are rewritten to stubs matching the new (empty) surface.

- Mock runtime gains `pallet-balances` so future tests can exercise currency transfers.
- Sanity test: the mock builds and test accounts have expected starting balances.
- **Done when:** one sanity test (`mock_runtime_builds`) passes and `cargo test -p pallet-content-registry` runs cleanly.

---

## Task 3 — Add `BulletinCid` type

The pallet gains the `BulletinCid { codec: u8, digest: [u8; 32] }` struct used by `Listing`. No storage or extrinsics yet.

- **Done when:** a SCALE-roundtrip test passes.

---

## Task 4 — Add `Listing<T>` struct + `NextListingId` + `Listings` storage

Data model lands. `Listing<T>` has all fields from spec §4: `creator`, `price`, `content_cid`, `content_hash`, `title` (≤128 B), `description` (≤2 KiB), `locked_content_lock_key` (≤128 B, empty in Phase 1), `created_at`. `NextListingId` is a `u64` counter; `Listings` is a `StorageMap<ListingId, Listing<T>>`.

- **Done when:** a test that inserts a listing by hand and reads it back passes.

---

## Task 5 — `create_listing` extrinsic (happy path)

First real extrinsic. Assigns a fresh `ListingId` from `NextListingId`, inserts into `Listings`, increments the counter, emits `ListingCreated { listing_id, creator, price }`. Adds the `ListingIdOverflow` error guard.

- **Done when:** a test that calls `create_listing`, asserts storage state and the emitted event, passes.

---

## Task 6 — `create_listing` validation: price > 0

Adds `ZeroPrice` error and `ensure!(!price.is_zero())`. Spec §4 forbids free listings in the PoC.

- **Done when:** a test calling `create_listing` with `price = 0` returns `ZeroPrice`.

---

## Task 7 — Add `Purchases` storage map

`Purchases: StorageMap<(ListingId, AccountId), BlockNumber>`. No extrinsic logic yet.

- **Done when:** a roundtrip test passes.

---

## Task 8 — `purchase` extrinsic (happy path)

Second real extrinsic. Loads the listing (errors with `ListingNotFound` if missing), transfers `price` native-token from buyer to creator via `T::Currency::transfer`, records `Purchases[(listing_id, buyer)] = now`, emits `PurchaseCompleted { listing_id, buyer, creator }`.

- **Done when:** a test asserts balance deltas (buyer −price, creator +price), the purchase record, and the event.

---

## Task 9 — `purchase` validation: buyer ≠ creator

Adds `BuyerIsCreator` error. Spec §4: "Creators cannot purchase their own listings."

- **Done when:** a test where `creator` purchases their own listing returns `BuyerIsCreator`.

---

## Task 10 — `purchase` validation: no double purchase

Adds `AlreadyPurchased` error + `contains_key` guard. Spec §4: "A given buyer can purchase any listing at most once."

- **Done when:** a test where the same buyer purchases the same listing twice errors on the second call.

---

## Task 11 — `purchase` validation: insufficient funds

Pins the behavior of a buyer without enough native-token balance — `Currency::transfer` already errors; this task just adds a test so regressions surface.

- **Done when:** a test with an under-funded buyer returns a dispatch error and leaves no `Purchases` record.

---

## Task 12 — `purchase` validation: listing-not-found test

Pins `ListingNotFound` behavior (error variant already added in Task 8). Also runs the full pallet suite to confirm all tests pass together.

- **Done when:** all pallet unit tests pass — roughly 8–10 tests covering happy paths + every validation rule + storage roundtrips.

---

## Task 13 — Benchmarks for `create_listing` and `purchase`

Rewrites `src/benchmarking.rs` with `#[benchmarks]` fns for both extrinsics. Uses `make_free_balance_be` to fund the buyer before the purchase benchmark. The placeholder weights from Task 2 remain; this task just ensures the benchmark module compiles and `impl_benchmark_test_suite!` runs each benchmark once.

- **Done when:** `cargo test -p pallet-content-registry --features runtime-benchmarks` passes.

---

## Task 14 — Wire `Currency = Balances` in runtime `Config` impl

Updates `blockchain/runtime/src/configs/mod.rs` to provide `type Currency = Balances;` on `pallet_content_registry::Config for Runtime`. The runtime couldn't build with just Task 2's `Config` trait change; this task closes that gap.

- **Done when:** `cargo check -p ppview-runtime --features std` and `--features runtime-benchmarks` both pass.

---

## Task 15 — Release build + WASM artifact

`cargo build --release -p ppview-runtime` produces the compact-compressed WASM that Zombienet will load. No file changes — pure verification.

- **Done when:** the WASM artifact exists under `target/release/wbuild/...` and the rest of the workspace builds cleanly.

---

## Task 16 — Zombienet E2E smoke script

Adds `scripts/smoke-content-registry.ts`. Under a running Zombienet (`./scripts/start-local.sh`), regenerates PAPI descriptors (`npm run codegen`), then from the script: creates a listing as `//Alice`, purchases it as `//Bob`, and verifies the `Purchases` record exists.

- **Done when:** the script runs against a local Zombienet, both txns are included, and the purchase record is readable via PAPI.

---

## After P1a

Deliverables the frontend plan (P1b) can assume from P1a:
- A parachain with `pallet-content-registry` at index 50.
- `create_listing` and `purchase` extrinsics callable via PAPI.
- Events `ListingCreated` / `PurchaseCompleted` subscribable.
- Storage `NextListingId`, `Listings`, `Purchases` queryable.
- A PAPI descriptor bundle generated from the runtime metadata.
- A Zombienet `start-local.sh` path that runs the full stack end-to-end.
