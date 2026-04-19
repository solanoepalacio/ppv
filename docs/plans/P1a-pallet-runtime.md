# P1a — Pallet + Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a custom FRAME pallet `pallet-content-registry` and wire it into the parachain runtime so that a creator can publish a listing and a buyer can purchase it, with native-token funds transferred atomically.

**Architecture:** Repurpose the stack template's `pallet-template` (PoE) as the basis for `pallet-content-registry`. The pallet holds two `StorageMap`s (`Listings`, `Purchases`) and a `StorageValue<u64>` counter, exposes `create_listing` and `purchase` extrinsics, uses the classic `Currency` trait for native-token transfers, and emits `ListingCreated` / `PurchaseCompleted` events. Runtime swaps `TemplatePallet` for `ContentRegistry` at pallet index 50. Existing pallets (balances, utility, statement, sudo, revive, XCM) are untouched.

**Tech Stack:** polkadot-sdk `stable2512-3`, `polkadot-sdk-frame` umbrella crate (`frame::pallet`), `pallet-balances` (for `Currency`), `pallet-utility` (for the future `batch_all` UX, already wired), Zombienet for local testing, `subxt` for the E2E smoke test.

**Scope carve-outs (not in this plan):**
- Phase 2 encryption fields (`ServicePublicKey`, `EncryptionKeys`, `WrappedKeys`, `grant_access`, `ServiceOrigin`) — deferred to P2 plan. The `locked_content_lock_key` field IS included in the Phase 1 `Listing` struct to avoid a storage migration later (bounded to 128 bytes, may be empty in P1).
- Frontend, Bulletin upload, Triangle sandbox — P1b.
- IPFS/DotNS deploy — P1c.
- Benchmarks on real hardware — placeholder weights are OK for the PoC.
- Removing upstream EVM/PVM/revive code — not a priority; leave the runtime as-is.

**Spec reference:** `docs/design/spec.md` §4 (Pallet design) is authoritative for extrinsic shapes, storage items, validation rules, and events.

**User convention:** The user commits docs themselves. For this plan, each task ends with a code commit — stage and run commits normally unless the user has opted for a different execution mode.

---

## File Structure

**Created / renamed:**
- `blockchain/pallets/content-registry/` (renamed from `blockchain/pallets/template/`)
  - `Cargo.toml` — pallet crate manifest, add `pallet-balances` to dev-deps
  - `src/lib.rs` — pallet module (Config, storage, events, errors, extrinsics)
  - `src/mock.rs` — mock runtime with `pallet-balances` wired in
  - `src/tests.rs` — unit test suite
  - `src/weights.rs` — `WeightInfo` trait + placeholder weights
  - `src/benchmarking.rs` — `#[benchmarks]` scaffolding

**Modified:**
- `Cargo.toml` (workspace root) — rename `pallet-template` → `pallet-content-registry`
- `blockchain/runtime/Cargo.toml` — update pallet dep + features
- `blockchain/runtime/src/lib.rs` — rename `TemplatePallet` → `ContentRegistry` (index 50)
- `blockchain/runtime/src/configs/mod.rs` — replace `pallet_template::Config` impl with `pallet_content_registry::Config` impl
- `blockchain/runtime/src/benchmarks.rs` — rename benchmark reference

**Untouched:**
- Anything under `web/`, `scripts/`, `docker/`, `.github/`, `contracts/`, `docs/`
- XCM configs, revive configs, Statement Store config
- Runtime version (bump only if we later migrate — for a fresh runtime, not needed)

---

## Task 1 — Rename `pallet-template` → `pallet-content-registry`

Mechanical rename across the workspace. Verify the runtime still builds afterwards (PoE logic is preserved at this point — we'll rewrite it in Task 2).

**Files:**
- Rename dir: `blockchain/pallets/template/` → `blockchain/pallets/content-registry/`
- Modify: `blockchain/pallets/content-registry/Cargo.toml`
- Modify: `Cargo.toml` (workspace root)
- Modify: `blockchain/runtime/Cargo.toml`
- Modify: `blockchain/runtime/src/lib.rs:253`
- Modify: `blockchain/runtime/src/configs/mod.rs:289-292`
- Modify: `blockchain/runtime/src/benchmarks.rs` (if it references pallet_template)

- [ ] **Step 1: Rename the pallet directory**

```bash
git mv blockchain/pallets/template blockchain/pallets/content-registry
```

- [ ] **Step 2: Rename the crate in the pallet's `Cargo.toml`**

Edit `blockchain/pallets/content-registry/Cargo.toml`, line 2:

```toml
[package]
name = "pallet-content-registry"
description = "Content registry pallet — stores listings and records purchases for pay-per-view."
version = "0.1.0"
```

Keep the rest of the manifest identical (deps, features).

- [ ] **Step 3: Update workspace `Cargo.toml`**

Edit `Cargo.toml` at the repo root. Change lines 3-7 and line 18:

```toml
members = [
    "blockchain/runtime",
    "blockchain/pallets/content-registry",
    "cli",
]
```

```toml
# Local crates
pallet-content-registry = { path = "./blockchain/pallets/content-registry", default-features = false }
```

Remove the old `pallet-template` line.

- [ ] **Step 4: Update runtime's `Cargo.toml` dep**

Edit `blockchain/runtime/Cargo.toml`. Find the `pallet-template` entry and replace with:

```toml
pallet-content-registry = { workspace = true }
```

Also update the `std` and `runtime-benchmarks` feature lists to reference `pallet-content-registry/std` and `pallet-content-registry/runtime-benchmarks` in place of the old `pallet-template/*` entries.

- [ ] **Step 5: Update runtime's `lib.rs` construct_runtime reference**

Edit `blockchain/runtime/src/lib.rs`, line 252-253:

```rust
#[runtime::pallet_index(50)]
pub type ContentRegistry = pallet_content_registry;
```

- [ ] **Step 6: Update runtime's `configs/mod.rs`**

Edit `blockchain/runtime/src/configs/mod.rs`, lines 289-292:

```rust
/// Configure the content-registry pallet.
impl pallet_content_registry::Config for Runtime {
    type WeightInfo = pallet_content_registry::weights::SubstrateWeight<Runtime>;
}
```

(We'll add `type Currency` in Task 14.)

- [ ] **Step 7: Update runtime's `benchmarks.rs`**

Search for any `pallet_template` occurrence in `blockchain/runtime/src/benchmarks.rs` and replace with `pallet_content_registry`.

```bash
grep -n pallet_template blockchain/runtime/src/benchmarks.rs
```

If matches exist, update them. If not, skip.

- [ ] **Step 8: Verify the pallet still builds**

Run: `cargo check -p pallet-content-registry`
Expected: OK (no errors; some unused-code warnings from the PoE leftovers are fine).

- [ ] **Step 9: Verify the runtime still builds**

Run: `cargo check -p stack-template-runtime --features std`
Expected: OK.

(Upstream crate name is `stack-template-runtime`. Runtime renaming is a separate concern — not done in this plan.)

- [ ] **Step 10: Commit**

```bash
git add Cargo.toml blockchain/pallets/content-registry blockchain/runtime
git commit -m "rename pallet-template to pallet-content-registry"
```

---

## Task 2 — Strip PoE code, add `Currency` to `Config`, rewire mock runtime

Replace the PoE claim logic with an empty-but-compiling scaffold that declares the `Currency` associated type. Mock runtime gains `pallet-balances`. Tests file gets emptied (tests rewritten in later tasks). After this task, the pallet does nothing but compiles and has a ready testbed.

**Files:**
- Modify: `blockchain/pallets/content-registry/Cargo.toml` (add `pallet-balances` dev-dep)
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/mock.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`
- Modify: `blockchain/pallets/content-registry/src/weights.rs`
- Modify: `blockchain/pallets/content-registry/src/benchmarking.rs`

- [ ] **Step 1: Add `pallet-balances` to dev-dependencies**

Edit `blockchain/pallets/content-registry/Cargo.toml`. Under `[dev-dependencies]`:

```toml
[dev-dependencies]
frame = { workspace = true, features = ["std", "experimental", "runtime"] }
pallet-balances = { version = "41.0.0", default-features = false, features = ["std"] }
sp-io = { workspace = true, features = ["std"] }
```

Note: `pallet-balances` version `41.0.0` matches polkadot-sdk `stable2512-3`. If the build later complains about a version mismatch, adjust to match the workspace-resolved version.

- [ ] **Step 2: Rewrite `src/lib.rs` to a minimal scaffold**

Replace the entire contents of `blockchain/pallets/content-registry/src/lib.rs` with:

```rust
//! # Content Registry Pallet
//!
//! Stores pay-per-view listings and records purchases. Native-token payment is
//! transferred from buyer to creator as part of `purchase`. In Phase 1 the
//! `locked_content_lock_key` field on a listing is empty; in Phase 2 it holds
//! a content-lock-key sealed to the service pubkey.

#![cfg_attr(not(feature = "std"), no_std)]

pub use pallet::*;

#[cfg(test)]
mod mock;

#[cfg(test)]
mod tests;

pub mod weights;

#[cfg(feature = "runtime-benchmarks")]
mod benchmarking;

#[frame::pallet]
pub mod pallet {
    use crate::weights::WeightInfo;
    use frame::{
        prelude::*,
        traits::{Currency, ExistenceRequirement},
    };

    pub type BalanceOf<T> = <<T as Config>::Currency as Currency<
        <T as frame_system::Config>::AccountId,
    >>::Balance;

    pub type ListingId = u64;

    #[pallet::pallet]
    pub struct Pallet<T>(_);

    #[pallet::config]
    pub trait Config: frame_system::Config {
        /// Native token source used for `purchase` transfers.
        type Currency: Currency<Self::AccountId>;
        /// Weights for the pallet's extrinsics.
        type WeightInfo: WeightInfo;
    }

    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {}

    #[pallet::error]
    pub enum Error<T> {}

    #[pallet::call]
    impl<T: Config> Pallet<T> {}
}
```

- [ ] **Step 3: Rewrite `src/weights.rs` to a minimal trait**

Replace the entire contents of `blockchain/pallets/content-registry/src/weights.rs` with:

```rust
//! Placeholder weights for pallet-content-registry.
//!
//! Real weights should be generated via `cargo bench` against a reference
//! machine — these are illustrative only and OK for the PoC.

#![cfg_attr(rustfmt, rustfmt_skip)]
#![allow(unused_parens)]
#![allow(unused_imports)]

use frame::{deps::frame_support::weights::constants::RocksDbWeight, prelude::*};
use core::marker::PhantomData;

pub trait WeightInfo {
    fn create_listing() -> Weight;
    fn purchase() -> Weight;
}

pub struct SubstrateWeight<T>(PhantomData<T>);
impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
    fn create_listing() -> Weight {
        Weight::from_parts(20_000_000, 2_000)
            .saturating_add(T::DbWeight::get().reads(1))
            .saturating_add(T::DbWeight::get().writes(2))
    }

    fn purchase() -> Weight {
        Weight::from_parts(40_000_000, 3_000)
            .saturating_add(T::DbWeight::get().reads(3))
            .saturating_add(T::DbWeight::get().writes(2))
    }
}

impl WeightInfo for () {
    fn create_listing() -> Weight {
        Weight::from_parts(20_000_000, 2_000)
            .saturating_add(RocksDbWeight::get().reads(1))
            .saturating_add(RocksDbWeight::get().writes(2))
    }

    fn purchase() -> Weight {
        Weight::from_parts(40_000_000, 3_000)
            .saturating_add(RocksDbWeight::get().reads(3))
            .saturating_add(RocksDbWeight::get().writes(2))
    }
}
```

- [ ] **Step 4: Rewrite `src/benchmarking.rs` to an empty benchmark module**

Replace contents:

```rust
//! Benchmarking setup for pallet-content-registry.
//!
//! Populated in Task 13 once the extrinsics are in place.

#![cfg(feature = "runtime-benchmarks")]

use super::*;
use frame::{deps::frame_benchmarking::v2::*, prelude::*};

#[benchmarks]
mod benchmarks {
    #[cfg(test)]
    use crate::pallet::Pallet as ContentRegistry;

    impl_benchmark_test_suite!(ContentRegistry, crate::mock::new_test_ext(), crate::mock::Test);
}
```

- [ ] **Step 5: Rewrite `src/mock.rs` with `pallet-balances` wired in**

Replace contents:

```rust
use frame::{
    deps::{frame_support::weights::constants::RocksDbWeight, frame_system::GenesisConfig},
    prelude::*,
    runtime::prelude::*,
    testing_prelude::*,
};

pub type AccountId = u64;
pub type Balance = u128;

#[frame_construct_runtime]
mod test_runtime {
    #[runtime::runtime]
    #[runtime::derive(
        RuntimeCall,
        RuntimeEvent,
        RuntimeError,
        RuntimeOrigin,
        RuntimeFreezeReason,
        RuntimeHoldReason,
        RuntimeSlashReason,
        RuntimeLockId,
        RuntimeTask,
        RuntimeViewFunction
    )]
    pub struct Test;

    #[runtime::pallet_index(0)]
    pub type System = frame_system;
    #[runtime::pallet_index(1)]
    pub type Balances = pallet_balances;
    #[runtime::pallet_index(2)]
    pub type ContentRegistry = crate;
}

#[derive_impl(frame_system::config_preludes::TestDefaultConfig)]
impl frame_system::Config for Test {
    type Nonce = u64;
    type Block = MockBlock<Test>;
    type AccountId = AccountId;
    type Lookup = sp_runtime::traits::IdentityLookup<AccountId>;
    type BlockHashCount = ConstU64<250>;
    type DbWeight = RocksDbWeight;
    type AccountData = pallet_balances::AccountData<Balance>;
}

#[derive_impl(pallet_balances::config_preludes::TestDefaultConfig)]
impl pallet_balances::Config for Test {
    type Balance = Balance;
    type ExistentialDeposit = ConstU128<1>;
    type AccountStore = System;
}

impl crate::Config for Test {
    type Currency = Balances;
    type WeightInfo = ();
}

pub const ALICE: AccountId = 1;
pub const BOB: AccountId = 2;
pub const CHARLIE: AccountId = 3;

pub fn new_test_ext() -> TestState {
    let mut t = GenesisConfig::<Test>::default().build_storage().unwrap();
    pallet_balances::GenesisConfig::<Test> {
        balances: vec![(ALICE, 1_000_000), (BOB, 1_000_000), (CHARLIE, 500)],
        ..Default::default()
    }
    .assimilate_storage(&mut t)
    .unwrap();
    t.into()
}
```

- [ ] **Step 6: Clear `src/tests.rs` — keep only the sanity test**

Replace contents:

```rust
use crate::mock::*;
use frame::testing_prelude::*;

#[test]
fn mock_runtime_builds() {
    new_test_ext().execute_with(|| {
        assert_eq!(Balances::free_balance(ALICE), 1_000_000);
        assert_eq!(Balances::free_balance(BOB), 1_000_000);
    });
}
```

- [ ] **Step 7: Verify pallet builds and sanity test passes**

Run: `cargo test -p pallet-content-registry mock_runtime_builds`
Expected: 1 test passes.

If the build fails due to a `pallet-balances` version mismatch, run `cargo tree -p pallet-balances` to see which version other crates resolved to, and update the dev-dep version in `blockchain/pallets/content-registry/Cargo.toml` to match.

- [ ] **Step 8: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "strip PoE, add Currency to Config, wire pallet-balances into mock"
```

---

## Task 3 — Add `BulletinCid` type

The content CID on Bulletin Chain has two components: the multicodec prefix (`0x55` raw single-chunk, `0x70` dag-pb for chunked) and a 32-byte blake2b-256 digest. Model these together.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs` (inside the `pallet` module)
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test for the `BulletinCid` type**

Add to `src/tests.rs`:

```rust
use crate::pallet::BulletinCid;
use codec::{Decode, Encode};

#[test]
fn bulletin_cid_scale_roundtrip() {
    let cid = BulletinCid { codec: 0x55, digest: [0xabu8; 32] };
    let encoded = cid.encode();
    let decoded = BulletinCid::decode(&mut &encoded[..]).unwrap();
    assert_eq!(decoded.codec, 0x55);
    assert_eq!(decoded.digest, [0xabu8; 32]);
}
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cargo test -p pallet-content-registry bulletin_cid_scale_roundtrip`
Expected: FAIL with `cannot find type 'BulletinCid' in module 'crate::pallet'`.

- [ ] **Step 3: Add the `BulletinCid` type**

Edit `src/lib.rs`. Inside `pub mod pallet { ... }`, above `#[pallet::event]`, add:

```rust
    /// Content identifier for a Bulletin Chain upload.
    ///
    /// The full IPFS CID reconstructs as: CIDv1 + `codec` + multihash(0xb220, 32, `digest`).
    /// - `codec = 0x55` (raw) for single-chunk uploads ≤ 2 MiB
    /// - `codec = 0x70` (dag-pb) for chunked DAG manifests
    #[derive(Encode, Decode, Clone, Copy, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    pub struct BulletinCid {
        pub codec: u8,
        pub digest: [u8; 32],
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p pallet-content-registry bulletin_cid_scale_roundtrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "add BulletinCid type with SCALE roundtrip test"
```

---

## Task 4 — Add `Listing<T>` struct + `NextListingId` + `Listings` storage

No extrinsic yet — just the data model and storage items.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test that inserts and reads a listing**

Add to `src/tests.rs`:

```rust
use crate::pallet::{Listing, Listings, NextListingId};
use frame::traits::Get;

#[test]
fn listings_storage_roundtrip() {
    new_test_ext().execute_with(|| {
        assert_eq!(NextListingId::<Test>::get(), 0);

        let listing = Listing::<Test> {
            creator: ALICE,
            price: 100,
            content_cid: BulletinCid { codec: 0x55, digest: [0x11u8; 32] },
            content_hash: [0x22u8; 32],
            title: b"hello".to_vec().try_into().unwrap(),
            description: b"world".to_vec().try_into().unwrap(),
            locked_content_lock_key: Default::default(),
            created_at: 0,
        };
        Listings::<Test>::insert(0u64, listing.clone());

        let read = Listings::<Test>::get(0u64).unwrap();
        assert_eq!(read.creator, ALICE);
        assert_eq!(read.price, 100);
        assert_eq!(read.content_hash, [0x22u8; 32]);
    });
}
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cargo test -p pallet-content-registry listings_storage_roundtrip`
Expected: FAIL — `Listing`, `Listings`, `NextListingId` not found.

- [ ] **Step 3: Add `Listing<T>` struct and storage items**

Edit `src/lib.rs`, inside `pub mod pallet { ... }`, after `BulletinCid`:

```rust
    /// A published content listing.
    #[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
    #[scale_info(skip_type_params(T))]
    pub struct Listing<T: Config> {
        /// Account that published the listing and receives payment.
        pub creator: T::AccountId,
        /// Flat price in native token.
        pub price: BalanceOf<T>,
        /// Content CID on Bulletin Chain (ciphertext in Phase 2, plaintext in Phase 1).
        pub content_cid: BulletinCid,
        /// blake2b-256 of plaintext. Buyer frontend verifies after decryption.
        pub content_hash: [u8; 32],
        /// Display title.
        pub title: BoundedVec<u8, ConstU32<128>>,
        /// Display description.
        pub description: BoundedVec<u8, ConstU32<2048>>,
        /// Phase 2: content-lock-key sealed to `SVC_PUB`. Empty in Phase 1.
        pub locked_content_lock_key: BoundedVec<u8, ConstU32<128>>,
        /// Block number the listing was created at.
        pub created_at: BlockNumberFor<T>,
    }

    #[pallet::storage]
    pub type NextListingId<T: Config> = StorageValue<_, ListingId, ValueQuery>;

    #[pallet::storage]
    pub type Listings<T: Config> = StorageMap<_, Blake2_128Concat, ListingId, Listing<T>, OptionQuery>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test -p pallet-content-registry listings_storage_roundtrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "add Listing<T> + NextListingId + Listings storage"
```

---

## Task 5 — `create_listing` extrinsic (TDD, happy path)

Assigns a fresh ID, inserts the listing, emits `ListingCreated`.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test for `create_listing`**

Add to `src/tests.rs`:

```rust
fn sample_cid() -> BulletinCid {
    BulletinCid { codec: 0x55, digest: [0xaau8; 32] }
}

fn bvec<const N: u32>(bytes: &[u8]) -> BoundedVec<u8, ConstU32<N>> {
    bytes.to_vec().try_into().unwrap()
}

#[test]
fn create_listing_works() {
    new_test_ext().execute_with(|| {
        System::set_block_number(7);
        assert_ok!(ContentRegistry::create_listing(
            RuntimeOrigin::signed(ALICE),
            sample_cid(),
            [0x33u8; 32],
            bvec::<128>(b"cool pdf"),
            bvec::<2048>(b"a book i wrote"),
            500,
            bvec::<128>(&[]),
        ));

        assert_eq!(NextListingId::<Test>::get(), 1);
        let listing = Listings::<Test>::get(0u64).unwrap();
        assert_eq!(listing.creator, ALICE);
        assert_eq!(listing.price, 500);
        assert_eq!(listing.created_at, 7);
        assert_eq!(listing.title.to_vec(), b"cool pdf".to_vec());

        System::assert_last_event(
            crate::Event::ListingCreated { listing_id: 0, creator: ALICE, price: 500 }.into(),
        );
    });
}
```

- [ ] **Step 2: Run the test — expect failure**

Run: `cargo test -p pallet-content-registry create_listing_works`
Expected: FAIL — `create_listing` not a method.

- [ ] **Step 3: Add the event and extrinsic**

Edit `src/lib.rs`. Update the event enum:

```rust
    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        ListingCreated {
            listing_id: ListingId,
            creator: T::AccountId,
            price: BalanceOf<T>,
        },
    }
```

Add the extrinsic to the `#[pallet::call]` block:

```rust
    #[pallet::call]
    impl<T: Config> Pallet<T> {
        #[pallet::call_index(0)]
        #[pallet::weight(T::WeightInfo::create_listing())]
        pub fn create_listing(
            origin: OriginFor<T>,
            content_cid: BulletinCid,
            content_hash: [u8; 32],
            title: BoundedVec<u8, ConstU32<128>>,
            description: BoundedVec<u8, ConstU32<2048>>,
            price: BalanceOf<T>,
            locked_content_lock_key: BoundedVec<u8, ConstU32<128>>,
        ) -> DispatchResult {
            let creator = ensure_signed(origin)?;

            let listing_id = NextListingId::<T>::get();
            let next = listing_id.checked_add(1).ok_or(Error::<T>::ListingIdOverflow)?;

            let listing = Listing::<T> {
                creator: creator.clone(),
                price,
                content_cid,
                content_hash,
                title,
                description,
                locked_content_lock_key,
                created_at: frame_system::Pallet::<T>::block_number(),
            };

            Listings::<T>::insert(listing_id, listing);
            NextListingId::<T>::put(next);

            Self::deposit_event(Event::ListingCreated { listing_id, creator, price });
            Ok(())
        }
    }
```

Update the error enum to include the overflow variant:

```rust
    #[pallet::error]
    pub enum Error<T> {
        /// The listing ID counter overflowed `u64::MAX`.
        ListingIdOverflow,
    }
```

- [ ] **Step 4: Run the test — expect pass**

Run: `cargo test -p pallet-content-registry create_listing_works`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "add create_listing extrinsic with ListingCreated event"
```

---

## Task 6 — `create_listing` validation: `price > 0`

Spec §4: "`create_listing`: `price > 0`. Free content is out of scope for the PoC."

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test for the price-must-be-positive rule**

Add to `src/tests.rs`:

```rust
#[test]
fn create_listing_fails_if_price_zero() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            ContentRegistry::create_listing(
                RuntimeOrigin::signed(ALICE),
                sample_cid(),
                [0x33u8; 32],
                bvec::<128>(b"free"),
                bvec::<2048>(b""),
                0,
                bvec::<128>(&[]),
            ),
            crate::Error::<Test>::ZeroPrice,
        );
    });
}
```

- [ ] **Step 2: Run — expect failure**

Run: `cargo test -p pallet-content-registry create_listing_fails_if_price_zero`
Expected: FAIL — `ZeroPrice` variant doesn't exist.

- [ ] **Step 3: Add the error variant and the check**

Edit `src/lib.rs`. Extend `Error<T>`:

```rust
    #[pallet::error]
    pub enum Error<T> {
        ListingIdOverflow,
        /// Listings must have a positive price.
        ZeroPrice,
    }
```

At the top of `create_listing`, after `ensure_signed`, insert:

```rust
            ensure!(!price.is_zero(), Error::<T>::ZeroPrice);
```

You'll also need to bring `Zero` into scope. Update the `use` block at the top of `pub mod pallet`:

```rust
    use frame::{
        prelude::*,
        traits::{Currency, ExistenceRequirement},
    };
    use frame::deps::sp_runtime::traits::Zero;
```

- [ ] **Step 4: Run — expect pass**

Run: `cargo test -p pallet-content-registry create_listing_fails_if_price_zero`
Expected: PASS. Also re-run the happy-path test to confirm no regression:

```bash
cargo test -p pallet-content-registry create_listing
```

Both tests should pass.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "reject create_listing with zero price"
```

---

## Task 7 — Add `Purchases` storage

Parametrized by `(ListingId, AccountId)`. No extrinsic logic yet.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test that inserts a purchase record**

Add to `src/tests.rs`:

```rust
use crate::pallet::Purchases;

#[test]
fn purchases_storage_roundtrip() {
    new_test_ext().execute_with(|| {
        Purchases::<Test>::insert((0u64, BOB), 5u64);
        assert_eq!(Purchases::<Test>::get((0u64, BOB)), Some(5));
        assert_eq!(Purchases::<Test>::get((0u64, ALICE)), None);
    });
}
```

- [ ] **Step 2: Run — expect failure**

Run: `cargo test -p pallet-content-registry purchases_storage_roundtrip`
Expected: FAIL — `Purchases` not found.

- [ ] **Step 3: Add the `Purchases` storage map**

Edit `src/lib.rs`, add after `Listings`:

```rust
    /// Records each buyer's purchase of a listing, keyed by (listing_id, buyer).
    /// Value is the block number the purchase was completed at.
    #[pallet::storage]
    pub type Purchases<T: Config> =
        StorageMap<_, Blake2_128Concat, (ListingId, T::AccountId), BlockNumberFor<T>, OptionQuery>;
```

- [ ] **Step 4: Run — expect pass**

Run: `cargo test -p pallet-content-registry purchases_storage_roundtrip`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "add Purchases storage map"
```

---

## Task 8 — `purchase` extrinsic (TDD, happy path)

Transfers `price` from buyer to creator, records the purchase, emits `PurchaseCompleted`.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test**

Add to `src/tests.rs`:

```rust
fn seed_listing(creator: AccountId, price: Balance) -> u64 {
    assert_ok!(ContentRegistry::create_listing(
        RuntimeOrigin::signed(creator),
        sample_cid(),
        [0x33u8; 32],
        bvec::<128>(b"t"),
        bvec::<2048>(b"d"),
        price,
        bvec::<128>(&[]),
    ));
    NextListingId::<Test>::get() - 1
}

#[test]
fn purchase_works_and_transfers_funds() {
    new_test_ext().execute_with(|| {
        System::set_block_number(10);
        let listing_id = seed_listing(ALICE, 300);

        let alice_before = Balances::free_balance(ALICE);
        let bob_before = Balances::free_balance(BOB);

        assert_ok!(ContentRegistry::purchase(RuntimeOrigin::signed(BOB), listing_id));

        assert_eq!(Balances::free_balance(ALICE), alice_before + 300);
        assert_eq!(Balances::free_balance(BOB), bob_before - 300);
        assert_eq!(Purchases::<Test>::get((listing_id, BOB)), Some(10));

        System::assert_last_event(
            crate::Event::PurchaseCompleted {
                listing_id,
                buyer: BOB,
                creator: ALICE,
            }
            .into(),
        );
    });
}
```

- [ ] **Step 2: Run — expect failure**

Run: `cargo test -p pallet-content-registry purchase_works_and_transfers_funds`
Expected: FAIL — `purchase` not a method.

- [ ] **Step 3: Add the event variant**

Edit `src/lib.rs`. Extend `Event<T>`:

```rust
    #[pallet::event]
    #[pallet::generate_deposit(pub(super) fn deposit_event)]
    pub enum Event<T: Config> {
        ListingCreated {
            listing_id: ListingId,
            creator: T::AccountId,
            price: BalanceOf<T>,
        },
        PurchaseCompleted {
            listing_id: ListingId,
            buyer: T::AccountId,
            creator: T::AccountId,
        },
    }
```

Extend `Error<T>`:

```rust
    #[pallet::error]
    pub enum Error<T> {
        ListingIdOverflow,
        ZeroPrice,
        /// No listing exists for the given ID.
        ListingNotFound,
    }
```

- [ ] **Step 4: Add the `purchase` extrinsic**

Append to the `#[pallet::call]` block, after `create_listing`:

```rust
        #[pallet::call_index(1)]
        #[pallet::weight(T::WeightInfo::purchase())]
        pub fn purchase(origin: OriginFor<T>, listing_id: ListingId) -> DispatchResult {
            let buyer = ensure_signed(origin)?;
            let listing = Listings::<T>::get(listing_id).ok_or(Error::<T>::ListingNotFound)?;

            T::Currency::transfer(
                &buyer,
                &listing.creator,
                listing.price,
                ExistenceRequirement::KeepAlive,
            )?;

            let now = frame_system::Pallet::<T>::block_number();
            Purchases::<T>::insert((listing_id, buyer.clone()), now);

            Self::deposit_event(Event::PurchaseCompleted {
                listing_id,
                buyer,
                creator: listing.creator,
            });
            Ok(())
        }
```

- [ ] **Step 5: Run — expect pass**

Run: `cargo test -p pallet-content-registry purchase_works_and_transfers_funds`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "add purchase extrinsic with currency transfer + PurchaseCompleted event"
```

---

## Task 9 — `purchase` validation: buyer ≠ creator

Spec §4: "`purchase`: `buyer != creator`. Creators cannot purchase their own listings."

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test**

Add to `src/tests.rs`:

```rust
#[test]
fn purchase_fails_if_buyer_is_creator() {
    new_test_ext().execute_with(|| {
        let listing_id = seed_listing(ALICE, 100);
        assert_noop!(
            ContentRegistry::purchase(RuntimeOrigin::signed(ALICE), listing_id),
            crate::Error::<Test>::BuyerIsCreator,
        );
    });
}
```

- [ ] **Step 2: Run — expect failure**

Run: `cargo test -p pallet-content-registry purchase_fails_if_buyer_is_creator`
Expected: FAIL — `BuyerIsCreator` not defined.

- [ ] **Step 3: Add the error variant and the guard**

In `Error<T>`, add:

```rust
        /// Creators cannot purchase their own listings.
        BuyerIsCreator,
```

In `purchase`, after loading the listing, before the transfer:

```rust
            ensure!(buyer != listing.creator, Error::<T>::BuyerIsCreator);
```

- [ ] **Step 4: Run — expect pass**

Run: `cargo test -p pallet-content-registry purchase`
Expected: both `purchase_*` tests pass.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "reject purchase when buyer equals creator"
```

---

## Task 10 — `purchase` validation: no double purchase

Spec §4: "`purchase`: `Purchases[(listing_id, buyer)]` must not already exist. A given buyer can purchase any listing at most once."

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs`
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write a failing test**

Add to `src/tests.rs`:

```rust
#[test]
fn purchase_fails_if_already_purchased() {
    new_test_ext().execute_with(|| {
        let listing_id = seed_listing(ALICE, 50);
        assert_ok!(ContentRegistry::purchase(RuntimeOrigin::signed(BOB), listing_id));
        assert_noop!(
            ContentRegistry::purchase(RuntimeOrigin::signed(BOB), listing_id),
            crate::Error::<Test>::AlreadyPurchased,
        );
    });
}
```

- [ ] **Step 2: Run — expect failure**

Run: `cargo test -p pallet-content-registry purchase_fails_if_already_purchased`
Expected: FAIL — `AlreadyPurchased` not defined.

- [ ] **Step 3: Add the error and guard**

In `Error<T>`, add:

```rust
        /// This buyer has already purchased this listing.
        AlreadyPurchased,
```

In `purchase`, after the `BuyerIsCreator` check, before the transfer:

```rust
            ensure!(
                !Purchases::<T>::contains_key((listing_id, &buyer)),
                Error::<T>::AlreadyPurchased,
            );
```

- [ ] **Step 4: Run — expect pass**

Run: `cargo test -p pallet-content-registry purchase`
Expected: all `purchase_*` tests pass.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "reject purchase if buyer already purchased listing"
```

---

## Task 11 — `purchase` validation: insufficient funds surfaces a dispatch error

The `Currency::transfer` call already returns an error on insufficient funds — we just need a test to pin that behavior.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write the test**

Add to `src/tests.rs`:

```rust
#[test]
fn purchase_fails_if_buyer_cannot_afford_it() {
    new_test_ext().execute_with(|| {
        // CHARLIE starts with 500; a 1000-price listing exceeds the keep-alive headroom.
        let listing_id = seed_listing(ALICE, 1_000);
        assert!(ContentRegistry::purchase(RuntimeOrigin::signed(CHARLIE), listing_id).is_err());
        // Nothing recorded.
        assert_eq!(Purchases::<Test>::get((listing_id, CHARLIE)), None);
    });
}
```

- [ ] **Step 2: Run — expect pass**

Run: `cargo test -p pallet-content-registry purchase_fails_if_buyer_cannot_afford_it`
Expected: PASS. (The error variant is a `pallet-balances` dispatch error, not ours, which is why we check for `is_err()` rather than a specific variant.)

- [ ] **Step 3: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "pin purchase behavior on insufficient buyer funds"
```

---

## Task 12 — Listing-not-found sanity test

We added the `ListingNotFound` error in Task 8; pin a test for it.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/tests.rs`

- [ ] **Step 1: Write the test**

```rust
#[test]
fn purchase_fails_if_listing_missing() {
    new_test_ext().execute_with(|| {
        assert_noop!(
            ContentRegistry::purchase(RuntimeOrigin::signed(BOB), 42),
            crate::Error::<Test>::ListingNotFound,
        );
    });
}
```

- [ ] **Step 2: Run — expect pass**

Run: `cargo test -p pallet-content-registry purchase_fails_if_listing_missing`
Expected: PASS.

- [ ] **Step 3: Run the whole pallet test suite**

Run: `cargo test -p pallet-content-registry`
Expected: all tests (8 or so) pass.

- [ ] **Step 4: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "pin purchase listing-not-found behavior"
```

---

## Task 13 — Add benchmarks for the two extrinsics

Benchmarks wire into the runtime's benchmark registry and into `pallet-content-registry::weights::SubstrateWeight`. For the PoC we keep the values from Task 2's placeholder weights and just make sure the benchmark code compiles and runs.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/benchmarking.rs`

- [ ] **Step 1: Write the benchmarks**

Replace `src/benchmarking.rs` contents:

```rust
//! Benchmarking setup for pallet-content-registry.

#![cfg(feature = "runtime-benchmarks")]

use super::*;
use frame::{deps::frame_benchmarking::v2::*, prelude::*};
use frame::traits::Currency;
use frame_system::RawOrigin;

#[benchmarks]
mod benchmarks {
    use super::*;
    #[cfg(test)]
    use crate::pallet::Pallet as ContentRegistry;

    fn sample_cid() -> crate::pallet::BulletinCid {
        crate::pallet::BulletinCid { codec: 0x55, digest: [0x11u8; 32] }
    }

    #[benchmark]
    fn create_listing() {
        let caller: T::AccountId = whitelisted_caller();
        let title: BoundedVec<u8, ConstU32<128>> = vec![0u8; 32].try_into().unwrap();
        let desc: BoundedVec<u8, ConstU32<2048>> = vec![0u8; 128].try_into().unwrap();
        let locked: BoundedVec<u8, ConstU32<128>> = vec![].try_into().unwrap();
        let price: BalanceOf<T> = 1_000u32.into();

        #[extrinsic_call]
        create_listing(
            RawOrigin::Signed(caller.clone()),
            sample_cid(),
            [0u8; 32],
            title,
            desc,
            price,
            locked,
        );

        assert!(Listings::<T>::contains_key(0u64));
    }

    #[benchmark]
    fn purchase() {
        let creator: T::AccountId = whitelisted_caller();
        let buyer: T::AccountId = account("buyer", 0, 0);

        let price: BalanceOf<T> = 100u32.into();
        // Give the buyer plenty of balance to cover price + existential deposit.
        let initial: BalanceOf<T> = 1_000_000u32.into();
        T::Currency::make_free_balance_be(&buyer, initial);

        let title: BoundedVec<u8, ConstU32<128>> = vec![0u8; 32].try_into().unwrap();
        let desc: BoundedVec<u8, ConstU32<2048>> = vec![0u8; 128].try_into().unwrap();
        let locked: BoundedVec<u8, ConstU32<128>> = vec![].try_into().unwrap();

        Pallet::<T>::create_listing(
            RawOrigin::Signed(creator).into(),
            sample_cid(),
            [0u8; 32],
            title,
            desc,
            price,
            locked,
        )
        .unwrap();

        #[extrinsic_call]
        purchase(RawOrigin::Signed(buyer.clone()), 0u64);

        assert!(Purchases::<T>::contains_key((0u64, buyer)));
    }

    impl_benchmark_test_suite!(ContentRegistry, crate::mock::new_test_ext(), crate::mock::Test);
}
```

- [ ] **Step 2: Verify benchmarks compile**

Run: `cargo check -p pallet-content-registry --features runtime-benchmarks`
Expected: OK.

- [ ] **Step 3: Run the benchmark test suite**

Run: `cargo test -p pallet-content-registry --features runtime-benchmarks`
Expected: PASS — the `impl_benchmark_test_suite!` macro generates a test that runs each benchmark once.

- [ ] **Step 4: Commit**

```bash
git add blockchain/pallets/content-registry
git commit -m "add benchmarks for create_listing and purchase"
```

---

## Task 14 — Wire `Currency` into the runtime `Config` impl

The pallet now requires `type Currency`. Update the runtime to provide `Balances`.

**Files:**
- Modify: `blockchain/runtime/src/configs/mod.rs` (the impl we left in Task 1)

- [ ] **Step 1: Update the `Config` impl**

Edit `blockchain/runtime/src/configs/mod.rs`, find the `impl pallet_content_registry::Config for Runtime` block from Task 1 and replace with:

```rust
/// Configure the content-registry pallet.
impl pallet_content_registry::Config for Runtime {
    type Currency = Balances;
    type WeightInfo = pallet_content_registry::weights::SubstrateWeight<Runtime>;
}
```

- [ ] **Step 2: Verify the runtime compiles**

Run: `cargo check -p stack-template-runtime --features std`
Expected: OK.

- [ ] **Step 3: Verify with runtime-benchmarks feature**

Run: `cargo check -p stack-template-runtime --features runtime-benchmarks`
Expected: OK.

- [ ] **Step 4: Commit**

```bash
git add blockchain/runtime/src/configs/mod.rs
git commit -m "wire Balances as ContentRegistry Currency in runtime"
```

---

## Task 15 — Full release build + WASM artifact

Produce the parachain WASM runtime. This is what Zombienet will load.

**Files:** none modified — this is a verification step.

- [ ] **Step 1: Clean build the runtime**

Run: `cargo build --release -p stack-template-runtime`
Expected: builds successfully. A `target/release/wbuild/stack-template-runtime/stack_template_runtime.compact.compressed.wasm` artifact is produced.

- [ ] **Step 2: Verify the full workspace builds**

Run: `cargo build --release`
Expected: OK. Some workspace members (`cli/`, `contracts/`) may still compile against the old API — if so, that's out of scope for this plan; note the failure and skip those targets with `-p` flags.

- [ ] **Step 3: Run the full pallet test suite one more time**

Run: `cargo test -p pallet-content-registry`
Expected: every test from Tasks 2–12 passes.

- [ ] **Step 4: Commit (empty — or skip if nothing to stage)**

If there are no changes from this task, no commit needed.

---

## Task 16 — Zombienet E2E smoke test via `polkadot-api` CLI

Confirm the runtime works end-to-end: spin up Zombienet, regenerate PAPI descriptors, submit `create_listing` and `purchase` via a throwaway TS script using dev keys (Alice, Bob).

**Files:**
- Create: `scripts/smoke-content-registry.ts`

- [ ] **Step 1: Start the local relay + parachain stack**

From the repo root:

```bash
./scripts/start-local.sh
```

Expected: Zombienet logs show the relay chain producing blocks and the parachain collating at `ws://127.0.0.1:9988` (or the port shown in the Zombienet output). Leave this running in another terminal.

- [ ] **Step 2: Regenerate PAPI descriptors for the new runtime**

The frontend ships PAPI descriptors under `web/.papi/`. Regenerate them against the running node:

```bash
cd web
npm install   # if not already
npm run codegen
cd ..
```

Expected: `web/.papi/descriptors/` contains fresh `stack_template.ts` (or equivalent name from `polkadot-api.json`) with `pallets.ContentRegistry` in it.

If the generator output uses a different symbol name (e.g. because the runtime crate is still called `stack-template-runtime`), that's fine — we reference what the generator produced.

- [ ] **Step 3: Write the smoke script**

Create `scripts/smoke-content-registry.ts`:

```ts
import { createClient, Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";
// Import path depends on the name chosen in web/.papi/polkadot-api.json.
// If the descriptor key is "stack_template", this is:
import { stack_template } from "../web/.papi/descriptors/dist";

const PARACHAIN_WS = process.env.PARACHAIN_WS ?? "ws://127.0.0.1:9988";

function devSigner(path: string) {
    const entropy = mnemonicToEntropy(DEV_PHRASE);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const keypair = derive(path);
    return getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);
}

async function main() {
    const client = createClient(withPolkadotSdkCompat(getWsProvider(PARACHAIN_WS)));
    const api = client.getTypedApi(stack_template);

    const alice = devSigner("//Alice");
    const bob = devSigner("//Bob");

    // Create a listing as Alice.
    const digest = new Uint8Array(32);
    digest.fill(0xaa);

    const createTx = api.tx.ContentRegistry.create_listing({
        content_cid: { codec: 0x55, digest: Binary.fromBytes(digest) },
        content_hash: Binary.fromBytes(new Uint8Array(32).fill(0x33)),
        title: Binary.fromText("smoke"),
        description: Binary.fromText("created by smoke script"),
        price: 500n,
        locked_content_lock_key: Binary.fromBytes(new Uint8Array()),
    });

    const createResult = await createTx.signAndSubmit(alice);
    if (!createResult.ok) {
        throw new Error(`create_listing failed: ${JSON.stringify(createResult)}`);
    }
    console.log("create_listing included at", createResult.block.hash);

    // Read the latest listing ID back.
    const nextId = await api.query.ContentRegistry.NextListingId.getValue();
    const listingId = nextId - 1n;
    console.log("created listing_id:", listingId);

    // Purchase as Bob.
    const purchaseTx = api.tx.ContentRegistry.purchase({ listing_id: listingId });
    const purchaseResult = await purchaseTx.signAndSubmit(bob);
    if (!purchaseResult.ok) {
        throw new Error(`purchase failed: ${JSON.stringify(purchaseResult)}`);
    }
    console.log("purchase included at", purchaseResult.block.hash);

    // Verify the purchase record exists.
    const record = await api.query.ContentRegistry.Purchases.getValue(listingId, (bob as any).publicKey);
    console.log("purchase record:", record);

    await client.destroy();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
```

Notes for the executing engineer:
- The exact symbol `stack_template` comes from `web/.papi/polkadot-api.json`'s entry key. If it's different (e.g. `parachain`), adjust the import.
- Field names (`create_listing` vs `createListing`, etc.) may be camelCased by PAPI. Match whatever the generator produced by opening `web/.papi/descriptors/dist/*.d.ts` and reading the typed API surface.
- If `scripts/package.json` uses a different test runner (e.g. `tsx`, `bun`), invoke with that.

- [ ] **Step 4: Run the smoke script**

```bash
cd scripts
npx tsx smoke-content-registry.ts
cd ..
```

Expected output:
```
create_listing included at 0x…
created listing_id: 0
purchase included at 0x…
purchase record: <block number>
```

If it errors on "Invalid metadata", the codegen in Step 2 was against the wrong endpoint — redo Step 2 with the correct `PARACHAIN_WS`.

- [ ] **Step 5: Tear down Zombienet**

In the terminal running `start-local.sh`: `Ctrl-C`. Check the output confirms a clean shutdown.

- [ ] **Step 6: Commit the smoke script**

```bash
git add scripts/smoke-content-registry.ts
git commit -m "add E2E smoke script for content-registry"
```

---

## Task 17 — Clean up stale template references + register pallet benchmarks in runtime

The template→content-registry rename in Task 1 was deliberately mechanical; it left behind stale docs and a cosmetic function name. Also, Task 13 added pallet-level benchmarks but never registered them with the runtime's `define_benchmarks!` macro, so `frame-omni-bencher` wouldn't see them. Fix both.

**Files:**
- Modify: `blockchain/runtime/src/genesis_config_presets.rs`
- Modify: `blockchain/runtime/README.md`
- Modify: `blockchain/README.md`
- Modify: `blockchain/runtime/src/benchmarks.rs`

- [ ] **Step 1: Rename `template_session_keys` → `session_keys`**

Edit `blockchain/runtime/src/genesis_config_presets.rs`. Rename the function defined at line 24 and the call site at line 50:

```rust
pub fn session_keys(keys: AuraId) -> SessionKeys {
    SessionKeys { aura: keys }
}
```

```rust
        session: SessionConfig {
            keys: invulnerables
                .into_iter()
                .map(|(acc, aura)| { (acc.clone(), acc, session_keys(aura),) })
                .collect::<Vec<_>>(),
        },
```

- [ ] **Step 2: Update `blockchain/runtime/README.md`**

Replace the line documenting `TemplatePallet` (currently line 8) with one describing `ContentRegistry`:

```markdown
- **ContentRegistry** (index 50): pay-per-view listings and purchase records — see [`../pallets/content-registry/`](../pallets/content-registry/)
```

- [ ] **Step 3: Update `blockchain/README.md`**

Replace the `pallets/template/` directory-guide row (currently line 9) with:

```markdown
| [`pallets/content-registry/`](pallets/content-registry/) | The pay-per-view content registry FRAME pallet |
```

And update the `cargo test` command (currently line 23):

```bash
# Pallet unit tests
cargo test -p pallet-content-registry
```

- [ ] **Step 4: Register the pallet in the runtime's benchmark list**

Edit `blockchain/runtime/src/benchmarks.rs`. Append one entry inside the `define_benchmarks!` macro:

```rust
polkadot_sdk::frame_benchmarking::define_benchmarks!(
    [frame_system, SystemBench::<Runtime>]
    [pallet_balances, Balances]
    [pallet_session, SessionBench::<Runtime>]
    [pallet_timestamp, Timestamp]
    [pallet_message_queue, MessageQueue]
    [pallet_sudo, Sudo]
    [pallet_collator_selection, CollatorSelection]
    [cumulus_pallet_parachain_system, ParachainSystem]
    [cumulus_pallet_xcmp_queue, XcmpQueue]
    [cumulus_pallet_weight_reclaim, WeightReclaim]
    [pallet_content_registry, ContentRegistry]
);
```

- [ ] **Step 5: Verify the runtime compiles with the benchmarks feature**

Run: `cargo check -p stack-template-runtime --features runtime-benchmarks`
Expected: OK.

- [ ] **Step 6: Verify the runtime still compiles without the benchmarks feature**

Run: `cargo check -p stack-template-runtime --features std`
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add blockchain/runtime/src/genesis_config_presets.rs blockchain/runtime/README.md blockchain/README.md blockchain/runtime/src/benchmarks.rs
git commit -m "clean up template leftovers and register pallet-content-registry benchmarks"
```

**Out-of-scope for this task:** renaming the runtime crate (`stack-template-runtime`), updating workspace `Cargo.toml` `homepage`/`repository`, or changing the runtime `spec_name` / `impl_name`. Those are broader branding concerns and not blocking.

---

## Done

After Task 17 the deliverable for P1a is complete:
- `pallet-content-registry` with `create_listing` + `purchase`, full unit-test coverage on happy paths and validation rules, benchmarks compile and are registered with the runtime.
- Runtime builds in release mode; WASM artifact produced.
- Parachain runs under Zombienet and accepts extrinsics end-to-end.
- No stray `template_*` references in docs or genesis.

Next: P1b (frontend MVP), which reads this pallet via PAPI, uploads content to Bulletin Chain, and renders the listing/purchase/view UI inside the Triangle sandbox.

---

## Self-review notes

- **Spec coverage (§4):** `create_listing` ✅ (Task 5+6), `purchase` ✅ (Task 8+9+10), `Listing` struct ✅ (Task 4), `BulletinCid` ✅ (Task 3), `Listings` + `Purchases` + `NextListingId` ✅ (Tasks 4, 7), Events `ListingCreated` + `PurchaseCompleted` ✅ (Tasks 5, 8), Errors `ZeroPrice` / `BuyerIsCreator` / `AlreadyPurchased` / `ListingNotFound` / `ListingIdOverflow` ✅ (Tasks 5, 6, 8, 9, 10). Phase 2 items (`ServicePublicKey`, `EncryptionKeys`, `WrappedKeys`, `register_encryption_key`, `grant_access`, `ServiceOrigin`) intentionally deferred.
- **Fee model (§4):** default Polkadot fee payment by caller — no overrides needed. `Pays::No` and `ServiceOrigin` are Phase 2 concerns.
- **Type consistency:** `BalanceOf<T>`, `ListingId = u64`, `BulletinCid { codec, digest }`, `Listing<T>` fields all used consistently across Tasks 3–14.
- **No placeholders:** all code steps contain full code; all run/expected pairs are concrete.
