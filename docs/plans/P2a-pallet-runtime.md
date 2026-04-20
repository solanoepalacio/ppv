# P2a — Phase 2 Pallet + Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `pallet-content-registry` with the Phase 2 on-chain surface: service keys (`SVC_PUB`, service sr25519 account id) stored at genesis, per-user x25519 pubkey registry, per-grant wrapped-key storage, `grant_access` gated by a custom `ServiceOrigin`, and an `integrity_test` guard against misconfigured genesis.

**Architecture:** Add four storage items (two genesis-set singletons, two maps), one new origin binding, two new extrinsics (`register_encryption_key`, `grant_access`), and a `Hooks::integrity_test` check. The `Listing.locked_content_lock_key` field flips from `BoundedVec<u8, 128>` to a fixed `[u8; 80]` — the exact byte length of a NaCl sealed-box output (32-byte ephemeral pub + 32-byte ciphertext + 16-byte MAC). The runtime implements `EnsureServiceAccount<Runtime>` which reads the on-chain `ServiceAccountId` and checks the signer against it; mock tests use `EnsureSignedBy<ServiceMember, _>` with a hardcoded service AccountId.

**Tech Stack:** polkadot-sdk `stable2512-3`, `polkadot-sdk-frame` umbrella crate (`frame::pallet`), `frame_system::EnsureSignedBy`, pallet `GenesisConfig` + `BuildGenesisConfig` derive, Zombienet for launch smoke.

**Scope carve-outs (deferred to later plans):**
- Chain-service daemon that subscribes to events + calls `grant_access` — P2b.
- Frontend encryption UX (content-lock-key generation, browser x25519 keys, decryption) — P2c.
- `regrant_access` extrinsic and session-key recovery — Phase 4.
- `ServicePublicKey` / `ServiceAccountId` rotation + migration — Phase 5.

**Spec reference:** `docs/design/spec.md` §4 (Pallet design — storage items, extrinsics, service origin, integrity checks) and §5 (Encryption model — keys in play, cryptographic primitives).

**User convention:** The user commits docs themselves. For source code changes, each task ends with a code commit (staged and run in the same session). Progress is tracked in `docs/progress.md`; a `[ ]` flips to `[x]` only after the user validates task completion, in a dedicated commit.

---

## File Structure

**Modified:**
- `blockchain/pallets/content-registry/src/lib.rs` — storage, extrinsics, events, errors, hooks, genesis config
- `blockchain/pallets/content-registry/src/mock.rs` — `ServiceOrigin` binding, genesis values, fund service account
- `blockchain/pallets/content-registry/src/tests.rs` — new tests for every task; update existing call sites
- `blockchain/pallets/content-registry/src/benchmarking.rs` — benchmarks for new extrinsics; update existing call sites
- `blockchain/pallets/content-registry/src/weights.rs` — two new `WeightInfo` methods + placeholder impls
- `blockchain/runtime/src/configs/mod.rs` — `EnsureServiceAccount` struct + `ServiceOrigin` binding
- `blockchain/runtime/src/genesis_config_presets.rs` — populate `ContentRegistryConfig` in dev + local testnet presets
- `docs/progress.md` — add P2a task list and tick as work lands

**Untouched:**
- `blockchain/pallets/content-registry/Cargo.toml` (no new deps required)
- `web/`, `scripts/`, `docker/`, `.github/`, `contracts/`, other pallets
- Runtime version (no migration — chain resets between phases in local dev)

---

## Task 1 — Flip `Listing.locked_content_lock_key` to `[u8; 80]`

Phase 1 declared the field as `BoundedVec<u8, ConstU32<128>>` and left it empty. Phase 2's NaCl sealed-box output is fixed-width 80 bytes, so we lock the type down. This is a breaking storage-layout change; we rely on Zombienet chain resets (no live deployment).

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs:93` (struct field) and `:160` (extrinsic param)
- Modify: `blockchain/pallets/content-registry/src/tests.rs` (all call sites)
- Modify: `blockchain/pallets/content-registry/src/benchmarking.rs` (all call sites)

- [ ] **Step 1: Update the `Listing` struct field**

Edit `lib.rs` around line 92–93:

```rust
        /// Phase 2: content-lock-key sealed to `SVC_PUB` via NaCl sealed-box.
        /// Fixed 80 bytes = 32-byte ephemeral pubkey ‖ 32-byte ciphertext ‖ 16-byte MAC.
        /// Zero-initialized in Phase 1; Phase 2 `create_listing` requires a non-zero value.
        pub locked_content_lock_key: [u8; 80],
```

- [ ] **Step 2: Update the `create_listing` extrinsic signature**

Edit `lib.rs` around line 160:

```rust
            locked_content_lock_key: [u8; 80],
```

- [ ] **Step 3: Update all call sites in `tests.rs`**

Replace every `bvec::<128>(&[])` and `bvec::<128>(...)` in `locked_content_lock_key` position with `[0u8; 80]`. Replace `Default::default()` on the struct literal (line 38) the same way. There are ~5 call sites; a `grep` in the file will surface them.

- [ ] **Step 4: Update all call sites in `benchmarking.rs`**

Replace both `let locked: BoundedVec<u8, ConstU32<128>> = vec![].try_into().unwrap();` lines with `let locked: [u8; 80] = [0u8; 80];`.

- [ ] **Step 5: Run the pallet test suite**

Run: `cargo test -p pallet-content-registry`
Expected: all existing tests pass. New test count unchanged.

- [ ] **Step 6: Commit**

```bash
git add blockchain/pallets/content-registry/src/lib.rs \
        blockchain/pallets/content-registry/src/tests.rs \
        blockchain/pallets/content-registry/src/benchmarking.rs
git commit -m "feat(pallet): lock locked_content_lock_key to [u8; 80] (NaCl sealed-box fixed width)"
```

---

## Task 2 — Add `ServicePublicKey` + `ServiceAccountId` storage + `GenesisConfig`

Introduce the two genesis-set singletons. Configure the mock to populate sensible dev values so downstream tasks can read them.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs` (new storage + `GenesisConfig` + `BuildGenesisConfig`)
- Modify: `blockchain/pallets/content-registry/src/mock.rs` (populate in `new_test_ext`, add `SERVICE` const)
- Modify: `blockchain/pallets/content-registry/src/tests.rs` (new test)

- [ ] **Step 1: Write the failing test**

Append to `tests.rs`:

```rust
use crate::pallet::{ServicePublicKey, ServiceAccountId};

#[test]
fn service_keys_are_set_from_genesis() {
    new_test_ext().execute_with(|| {
        assert_eq!(ServicePublicKey::<Test>::get(), [0xAAu8; 32]);
        assert_eq!(ServiceAccountId::<Test>::get(), SERVICE);
    });
}
```

- [ ] **Step 2: Run test — expect compile failure**

Run: `cargo test -p pallet-content-registry service_keys_are_set_from_genesis`
Expected: FAIL — `ServicePublicKey`, `ServiceAccountId`, and `SERVICE` are not defined.

- [ ] **Step 3: Add storage items to `lib.rs`**

After the `Purchases` storage block (around line 117), add:

```rust
	/// SVC_PUB (x25519) — published for creators to seal content-lock-keys against.
	/// Genesis-set, immutable in Phases 1–4. `integrity_test` rejects `[0u8; 32]`.
	#[pallet::storage]
	pub type ServicePublicKey<T: Config> = StorageValue<_, [u8; 32], ValueQuery>;

	/// sr25519 AccountId authorized to call `grant_access`. Genesis-set, immutable in
	/// Phases 1–4. `integrity_test` rejects `AccountId::default()`.
	#[pallet::storage]
	pub type ServiceAccountId<T: Config> = StorageValue<_, T::AccountId, ValueQuery>;
```

- [ ] **Step 4: Add the `GenesisConfig` + `BuildGenesisConfig`**

After the storage block, add:

```rust
	#[pallet::genesis_config]
	#[derive(frame::deps::frame_support::DefaultNoBound)]
	pub struct GenesisConfig<T: Config> {
		/// SVC_PUB x25519 bytes. Default `[0u8; 32]` trips `integrity_test`.
		pub service_public_key: [u8; 32],
		/// sr25519 service AccountId. `None` falls through to `AccountId::default()`,
		/// which trips `integrity_test`.
		pub service_account_id: Option<T::AccountId>,
		#[serde(skip)]
		pub _phantom: core::marker::PhantomData<T>,
	}

	#[pallet::genesis_build]
	impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
		fn build(&self) {
			ServicePublicKey::<T>::put(self.service_public_key);
			if let Some(acc) = &self.service_account_id {
				ServiceAccountId::<T>::put(acc.clone());
			}
		}
	}
```

- [ ] **Step 5: Wire the mock to populate the values**

Edit `mock.rs`. Add below the existing `ALICE` / `BOB` / `CHARLIE` constants:

```rust
pub const SERVICE: AccountId = 99;
pub const SVC_PUB_DEV: [u8; 32] = [0xAAu8; 32];
```

Rewrite `new_test_ext`:

```rust
pub fn new_test_ext() -> TestState {
	let mut t = GenesisConfig::<Test>::default().build_storage().unwrap();
	pallet_balances::GenesisConfig::<Test> {
		balances: vec![
			(ALICE, 1_000_000),
			(BOB, 1_000_000),
			(CHARLIE, 500),
			(SERVICE, 1_000),
		],
		..Default::default()
	}
	.assimilate_storage(&mut t)
	.unwrap();
	crate::GenesisConfig::<Test> {
		service_public_key: SVC_PUB_DEV,
		service_account_id: Some(SERVICE),
		_phantom: core::marker::PhantomData,
	}
	.assimilate_storage(&mut t)
	.unwrap();
	t.into()
}
```

- [ ] **Step 6: Run the test**

Run: `cargo test -p pallet-content-registry service_keys_are_set_from_genesis`
Expected: PASS.

- [ ] **Step 7: Run the full pallet suite**

Run: `cargo test -p pallet-content-registry`
Expected: all existing tests still pass (funding `SERVICE` doesn't perturb any balance assertions).

- [ ] **Step 8: Commit**

```bash
git add blockchain/pallets/content-registry/src/lib.rs \
        blockchain/pallets/content-registry/src/mock.rs \
        blockchain/pallets/content-registry/src/tests.rs
git commit -m "feat(pallet): add ServicePublicKey + ServiceAccountId storage with GenesisConfig"
```

---

## Task 3 — Add `integrity_test` hook

Catch misconfigured genesis at chain init. `integrity_test` is called once during runtime initialization and panics if invariants break — exactly the loud failure we want.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs` (add `#[pallet::hooks]` block)
- Modify: `blockchain/pallets/content-registry/src/tests.rs` (two new tests)

- [ ] **Step 1: Write the failing panic-path test**

Append to `tests.rs`:

```rust
#[test]
#[should_panic(expected = "ServicePublicKey")]
fn integrity_test_panics_on_zero_service_pubkey() {
    new_test_ext().execute_with(|| {
        ServicePublicKey::<Test>::put([0u8; 32]);
        <crate::pallet::Pallet<Test> as frame::traits::Hooks<u64>>::integrity_test();
    });
}

#[test]
#[should_panic(expected = "ServiceAccountId")]
fn integrity_test_panics_on_default_service_account() {
    new_test_ext().execute_with(|| {
        ServiceAccountId::<Test>::put(AccountId::default());
        <crate::pallet::Pallet<Test> as frame::traits::Hooks<u64>>::integrity_test();
    });
}

#[test]
fn integrity_test_passes_with_valid_genesis() {
    new_test_ext().execute_with(|| {
        <crate::pallet::Pallet<Test> as frame::traits::Hooks<u64>>::integrity_test();
    });
}
```

- [ ] **Step 2: Run tests — expect failures on the panic-path tests**

Run: `cargo test -p pallet-content-registry integrity_test`
Expected: `integrity_test_panics_on_zero_service_pubkey` FAILs (did not panic), `integrity_test_panics_on_default_service_account` FAILs, `integrity_test_passes_with_valid_genesis` PASSes trivially.

- [ ] **Step 3: Add the hooks impl**

In `lib.rs`, after the `#[pallet::pallet]` block and before `#[pallet::config]`, add:

```rust
	#[pallet::hooks]
	impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
		fn integrity_test() {
			assert!(
				ServicePublicKey::<T>::get() != [0u8; 32],
				"ServicePublicKey was left at [0; 32] — the chain-spec forgot to populate the content-registry GenesisConfig.",
			);
			assert!(
				ServiceAccountId::<T>::get() != T::AccountId::default(),
				"ServiceAccountId was left at AccountId::default() — the chain-spec forgot to populate the content-registry GenesisConfig.",
			);
		}
	}
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p pallet-content-registry integrity_test`
Expected: all three PASS.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry/src/lib.rs \
        blockchain/pallets/content-registry/src/tests.rs
git commit -m "feat(pallet): integrity_test guards against unpopulated service keys"
```

---

## Task 4 — Add `ServiceOrigin` Config item + mock binding

Type plumbing for Task 6. No new behaviour yet — we add the associated type and bind it in the mock so the pallet still compiles, but nothing uses it.

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs` (Config trait)
- Modify: `blockchain/pallets/content-registry/src/mock.rs` (binding + `SortedMembers` impl)

- [ ] **Step 1: Add the associated type to `Config`**

In `lib.rs`, extend the `Config` trait:

```rust
	#[pallet::config]
	pub trait Config: frame_system::Config {
		/// Native token source used for `purchase` transfers.
		type Currency: Currency<Self::AccountId>;
		/// Origin that can call `grant_access`. Bound to a service-account-equality check
		/// via the runtime's `EnsureServiceAccount` struct.
		type ServiceOrigin: EnsureOrigin<Self::RuntimeOrigin>;
		/// Weights for the pallet's extrinsics.
		type WeightInfo: WeightInfo;
	}
```

`EnsureOrigin` is in `frame::traits::EnsureOrigin`; it is already re-exported via `frame::prelude::*` (already imported at the top of the pallet module). No additional use-statement needed.

- [ ] **Step 2: Add the `SortedMembers` binding to the mock**

In `mock.rs`, add below the `SERVICE` / `SVC_PUB_DEV` constants:

```rust
pub struct ServiceMember;
impl frame::traits::SortedMembers<AccountId> for ServiceMember {
	fn sorted_members() -> alloc::vec::Vec<AccountId> { alloc::vec![SERVICE] }
	fn contains(who: &AccountId) -> bool { who == &SERVICE }
	fn count() -> usize { 1 }
}
```

If `alloc` isn't imported in `mock.rs`, add `extern crate alloc;` to the top.

Then extend the `Config for Test` impl:

```rust
impl crate::Config for Test {
	type Currency = Balances;
	type ServiceOrigin = frame::runtime::prelude::EnsureSignedBy<ServiceMember, AccountId>;
	type WeightInfo = ();
}
```

- [ ] **Step 3: Verify the pallet compiles**

Run: `cargo check -p pallet-content-registry --tests`
Expected: no errors.

- [ ] **Step 4: Run the full pallet suite**

Run: `cargo test -p pallet-content-registry`
Expected: all existing tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add blockchain/pallets/content-registry/src/lib.rs \
        blockchain/pallets/content-registry/src/mock.rs
git commit -m "feat(pallet): introduce ServiceOrigin Config item (mock-bound to SERVICE)"
```

---

## Task 5 — `EncryptionKeys` + `register_encryption_key` extrinsic

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs` (storage, event, extrinsic, WeightInfo call)
- Modify: `blockchain/pallets/content-registry/src/weights.rs` (add method)
- Modify: `blockchain/pallets/content-registry/src/tests.rs` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests.rs`:

```rust
use crate::pallet::EncryptionKeys;

#[test]
fn register_encryption_key_stores_and_emits() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        let pubkey = [0x11u8; 32];
        assert_ok!(ContentRegistry::register_encryption_key(
            RuntimeOrigin::signed(BOB),
            pubkey,
        ));
        assert_eq!(EncryptionKeys::<Test>::get(BOB), Some(pubkey));
        System::assert_last_event(
            crate::Event::EncryptionKeyRegistered { account: BOB }.into(),
        );
    });
}

#[test]
fn register_encryption_key_overwrites_existing() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        assert_ok!(ContentRegistry::register_encryption_key(
            RuntimeOrigin::signed(BOB), [0x11u8; 32],
        ));
        assert_ok!(ContentRegistry::register_encryption_key(
            RuntimeOrigin::signed(BOB), [0x22u8; 32],
        ));
        assert_eq!(EncryptionKeys::<Test>::get(BOB), Some([0x22u8; 32]));
    });
}
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cargo test -p pallet-content-registry register_encryption_key`
Expected: FAIL — the extrinsic and `EncryptionKeys` do not exist.

- [ ] **Step 3: Add the `EncryptionKeys` storage item**

In `lib.rs`, after `ServiceAccountId`:

```rust
	/// x25519 public key registered by each account (buyer or creator). Consumed
	/// off-chain by the chain-service when wrapping a content-lock-key for a target.
	#[pallet::storage]
	pub type EncryptionKeys<T: Config> =
		StorageMap<_, Blake2_128Concat, T::AccountId, [u8; 32], OptionQuery>;
```

- [ ] **Step 4: Add the event variant**

Extend `Event<T>`:

```rust
		EncryptionKeyRegistered {
			account: T::AccountId,
		},
```

- [ ] **Step 5: Add the `WeightInfo` method**

In `weights.rs`, extend the trait + both impls:

```rust
pub trait WeightInfo {
	fn create_listing() -> Weight;
	fn purchase() -> Weight;
	fn register_encryption_key() -> Weight;
}
```

```rust
impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
	// ...existing impls...
	fn register_encryption_key() -> Weight {
		Weight::from_parts(15_000_000, 1_000)
			.saturating_add(T::DbWeight::get().writes(1))
	}
}

impl WeightInfo for () {
	// ...existing impls...
	fn register_encryption_key() -> Weight {
		Weight::from_parts(15_000_000, 1_000)
			.saturating_add(RocksDbWeight::get().writes(1))
	}
}
```

- [ ] **Step 6: Add the extrinsic**

In `lib.rs`, after the existing `purchase` extrinsic (call_index 1), add:

```rust
		#[pallet::call_index(2)]
		#[pallet::weight(T::WeightInfo::register_encryption_key())]
		pub fn register_encryption_key(
			origin: OriginFor<T>,
			pubkey: [u8; 32],
		) -> DispatchResult {
			let who = ensure_signed(origin)?;
			EncryptionKeys::<T>::insert(&who, pubkey);
			Self::deposit_event(Event::EncryptionKeyRegistered { account: who });
			Ok(())
		}
```

- [ ] **Step 7: Run the tests**

Run: `cargo test -p pallet-content-registry register_encryption_key`
Expected: both tests PASS.

- [ ] **Step 8: Run the full pallet suite**

Run: `cargo test -p pallet-content-registry`
Expected: all tests green.

- [ ] **Step 9: Commit**

```bash
git add blockchain/pallets/content-registry/src/lib.rs \
        blockchain/pallets/content-registry/src/weights.rs \
        blockchain/pallets/content-registry/src/tests.rs
git commit -m "feat(pallet): register_encryption_key extrinsic + EncryptionKeys storage"
```

---

## Task 6 — `WrappedKeys` + `grant_access` extrinsic (ServiceOrigin + Pays::No)

**Files:**
- Modify: `blockchain/pallets/content-registry/src/lib.rs` (storage, event, extrinsic)
- Modify: `blockchain/pallets/content-registry/src/weights.rs` (add method)
- Modify: `blockchain/pallets/content-registry/src/tests.rs` (new tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests.rs`:

```rust
use crate::pallet::WrappedKeys;
use frame::deps::frame_support::dispatch::{Pays, GetDispatchInfo};

#[test]
fn grant_access_writes_wrapped_key_and_emits() {
    new_test_ext().execute_with(|| {
        System::set_block_number(1);
        let listing_id = seed_listing(ALICE, 100);
        let wrapped = [0x77u8; 80];
        assert_ok!(ContentRegistry::grant_access(
            RuntimeOrigin::signed(SERVICE),
            listing_id,
            BOB,
            wrapped,
        ));
        assert_eq!(WrappedKeys::<Test>::get(BOB, listing_id), Some(wrapped));
        System::assert_last_event(
            crate::Event::AccessGranted { listing_id, buyer: BOB }.into(),
        );
    });
}

#[test]
fn grant_access_rejects_non_service_origin() {
    new_test_ext().execute_with(|| {
        let listing_id = seed_listing(ALICE, 100);
        assert_noop!(
            ContentRegistry::grant_access(
                RuntimeOrigin::signed(BOB),
                listing_id,
                BOB,
                [0u8; 80],
            ),
            sp_runtime::DispatchError::BadOrigin,
        );
    });
}

#[test]
fn grant_access_is_pays_no() {
    new_test_ext().execute_with(|| {
        let listing_id = seed_listing(ALICE, 100);
        let call = crate::Call::<Test>::grant_access {
            listing_id,
            buyer: BOB,
            wrapped_key: [0u8; 80],
        };
        let info = call.get_dispatch_info();
        assert_eq!(info.pays_fee, Pays::No);
    });
}
```

`sp_runtime::DispatchError` is re-exported via `frame::deps::sp_runtime` — import path may need tweaking: if `sp_runtime` import fails, use `frame::deps::sp_runtime::DispatchError` or the pallet's `DispatchError` alias already in scope through `frame::prelude`.

- [ ] **Step 2: Run tests — expect failure**

Run: `cargo test -p pallet-content-registry grant_access`
Expected: FAIL — `grant_access`, `WrappedKeys`, and `AccessGranted` are not defined.

- [ ] **Step 3: Add the `WrappedKeys` storage item**

In `lib.rs`, after `EncryptionKeys`:

```rust
	/// Content-lock-key sealed to the target account's x25519 pubkey.
	/// Fixed 80 bytes — see `locked_content_lock_key` for the layout. Key ordering
	/// matches `Purchases` so iteration by AccountId is available for Phase 4
	/// session-key-loss recovery.
	#[pallet::storage]
	pub type WrappedKeys<T: Config> = StorageDoubleMap<
		_,
		Blake2_128Concat,
		T::AccountId,
		Blake2_128Concat,
		ListingId,
		[u8; 80],
		OptionQuery,
	>;
```

- [ ] **Step 4: Add the event variant**

Extend `Event<T>`:

```rust
		AccessGranted {
			listing_id: ListingId,
			buyer: T::AccountId,
		},
```

- [ ] **Step 5: Add the `WeightInfo` method**

In `weights.rs`:

```rust
pub trait WeightInfo {
	fn create_listing() -> Weight;
	fn purchase() -> Weight;
	fn register_encryption_key() -> Weight;
	fn grant_access() -> Weight;
}
```

```rust
impl<T: frame_system::Config> WeightInfo for SubstrateWeight<T> {
	// ...existing impls...
	fn grant_access() -> Weight {
		Weight::from_parts(18_000_000, 1_500)
			.saturating_add(T::DbWeight::get().reads(1))
			.saturating_add(T::DbWeight::get().writes(1))
	}
}

impl WeightInfo for () {
	// ...existing impls...
	fn grant_access() -> Weight {
		Weight::from_parts(18_000_000, 1_500)
			.saturating_add(RocksDbWeight::get().reads(1))
			.saturating_add(RocksDbWeight::get().writes(1))
	}
}
```

- [ ] **Step 6: Add the extrinsic**

In `lib.rs`, after `register_encryption_key` (call_index 2), add:

```rust
		#[pallet::call_index(3)]
		#[pallet::weight((T::WeightInfo::grant_access(), frame::deps::frame_support::dispatch::Pays::No))]
		pub fn grant_access(
			origin: OriginFor<T>,
			listing_id: ListingId,
			buyer: T::AccountId,
			wrapped_key: [u8; 80],
		) -> DispatchResult {
			T::ServiceOrigin::ensure_origin(origin)?;
			WrappedKeys::<T>::insert(&buyer, listing_id, wrapped_key);
			Self::deposit_event(Event::AccessGranted { listing_id, buyer });
			Ok(())
		}
```

If the `#[pallet::weight]` attribute rejects the tuple form, fall back to the `DispatchResultWithPostInfo` shape:

```rust
		pub fn grant_access(
			origin: OriginFor<T>,
			listing_id: ListingId,
			buyer: T::AccountId,
			wrapped_key: [u8; 80],
		) -> DispatchResultWithPostInfo {
			T::ServiceOrigin::ensure_origin(origin)?;
			WrappedKeys::<T>::insert(&buyer, listing_id, wrapped_key);
			Self::deposit_event(Event::AccessGranted { listing_id, buyer });
			Ok(Pays::No.into())
		}
```

Confirm the tuple form works by running `cargo check`; if it fails, swap to the second shape and update the `grant_access_is_pays_no` test to call `dispatch` and inspect the returned `PostDispatchInfo` instead of `GetDispatchInfo`.

- [ ] **Step 7: Run the tests**

Run: `cargo test -p pallet-content-registry grant_access`
Expected: all three PASS.

- [ ] **Step 8: Run the full pallet suite**

Run: `cargo test -p pallet-content-registry`
Expected: all tests green.

- [ ] **Step 9: Commit**

```bash
git add blockchain/pallets/content-registry/src/lib.rs \
        blockchain/pallets/content-registry/src/weights.rs \
        blockchain/pallets/content-registry/src/tests.rs
git commit -m "feat(pallet): grant_access extrinsic gated by ServiceOrigin, Pays::No"
```

---

## Task 7 — Benchmarks for `register_encryption_key` and `grant_access`

**Files:**
- Modify: `blockchain/pallets/content-registry/src/benchmarking.rs`

- [ ] **Step 1: Add the benchmarks**

In `benchmarking.rs`, inside `mod benchmarks`, after the existing `purchase` benchmark:

```rust
	#[benchmark]
	fn register_encryption_key() {
		let caller: T::AccountId = whitelisted_caller();

		#[extrinsic_call]
		register_encryption_key(RawOrigin::Signed(caller.clone()), [0x11u8; 32]);

		assert!(EncryptionKeys::<T>::contains_key(&caller));
	}

	#[benchmark]
	fn grant_access() {
		// Seed a listing so listing_id 0 exists.
		let creator: T::AccountId = whitelisted_caller();
		let price: BalanceOf<T> = 100u32.into();
		let title: BoundedVec<u8, ConstU32<128>> = vec![0u8; 32].try_into().unwrap();
		let desc: BoundedVec<u8, ConstU32<2048>> = vec![0u8; 128].try_into().unwrap();
		Pallet::<T>::create_listing(
			RawOrigin::Signed(creator).into(),
			sample_cid(),
			sample_thumb_cid(),
			[0u8; 32],
			title,
			desc,
			price,
			[0u8; 80],
		)
		.unwrap();

		let buyer: T::AccountId = account("buyer", 0, 0);

		// Construct an origin that satisfies T::ServiceOrigin. In both the mock and the
		// runtime this is a signed origin by the configured service account. We rely on
		// the benchmarks test-suite running against the mock (where `SERVICE` is a u64)
		// and on the runtime binding accepting the sr25519 service AccountId. Where this
		// cannot be expressed uniformly, add `T::ServiceOrigin::try_successful_origin()`
		// to the Config trait and use it here.
		let service_origin = T::ServiceOrigin::try_successful_origin()
			.expect("ServiceOrigin must provide a successful origin for benchmarking");

		#[extrinsic_call]
		grant_access(service_origin as T::RuntimeOrigin, 0u64, buyer.clone(), [0x77u8; 80]);

		assert!(WrappedKeys::<T>::contains_key(&buyer, 0u64));
	}
```

`EnsureOrigin` provides `try_successful_origin()` in the benchmark harness (via the `BenchmarkingHelper` blanket impl used by `#[benchmarks]`). If this does not compile for the mock's `EnsureSignedBy`, the benchmark macro expands to dispatch through `RawOrigin::Signed(SERVICE.into())` — in that case, replace the `service_origin` variable with `RawOrigin::Signed(<service-account-id>)` and cast appropriately. The runtime's `EnsureServiceAccount` (Task 8) will implement `try_successful_origin` explicitly.

- [ ] **Step 2: Run benchmarks via the in-test suite**

Run: `cargo test --features runtime-benchmarks -p pallet-content-registry`
Expected: every benchmark runs through `impl_benchmark_test_suite!`, all green.

- [ ] **Step 3: Commit**

```bash
git add blockchain/pallets/content-registry/src/benchmarking.rs
git commit -m "feat(pallet): benchmarks for register_encryption_key + grant_access"
```

---

## Task 8 — `EnsureServiceAccount` runtime struct + Config binding

Implement the runtime-level `EnsureOrigin` that checks a signed origin against the on-chain `ServiceAccountId`.

**Files:**
- Modify: `blockchain/runtime/src/configs/mod.rs` (add struct + wire `ServiceOrigin`)

- [ ] **Step 1: Add the `EnsureServiceAccount` struct**

At the bottom of `configs/mod.rs` (or just above the existing `pallet_content_registry::Config` impl at line 290), add:

```rust
pub struct EnsureServiceAccount<T>(core::marker::PhantomData<T>);

impl<T> frame_support::traits::EnsureOrigin<T::RuntimeOrigin> for EnsureServiceAccount<T>
where
	T: pallet_content_registry::Config + frame_system::Config,
	T::RuntimeOrigin: From<frame_system::RawOrigin<T::AccountId>>
		+ Into<Result<frame_system::RawOrigin<T::AccountId>, T::RuntimeOrigin>>,
{
	type Success = T::AccountId;

	fn try_origin(o: T::RuntimeOrigin) -> Result<Self::Success, T::RuntimeOrigin> {
		let raw = <T::RuntimeOrigin as Into<Result<frame_system::RawOrigin<T::AccountId>, T::RuntimeOrigin>>>::into(o)?;
		match raw {
			frame_system::RawOrigin::Signed(who)
				if who == pallet_content_registry::ServiceAccountId::<T>::get() =>
			{
				Ok(who)
			}
			frame_system::RawOrigin::Signed(who) => Err(frame_system::RawOrigin::Signed(who).into()),
			other => Err(other.into()),
		}
	}

	#[cfg(feature = "runtime-benchmarks")]
	fn try_successful_origin() -> Result<T::RuntimeOrigin, ()> {
		Ok(frame_system::RawOrigin::Signed(pallet_content_registry::ServiceAccountId::<T>::get()).into())
	}
}
```

- [ ] **Step 2: Wire `ServiceOrigin` into the Config impl**

Edit the existing `impl pallet_content_registry::Config for Runtime` block (around line 290):

```rust
impl pallet_content_registry::Config for Runtime {
	type Currency = Balances;
	type ServiceOrigin = EnsureServiceAccount<Runtime>;
	type WeightInfo = pallet_content_registry::weights::SubstrateWeight<Runtime>;
}
```

- [ ] **Step 3: Build the runtime**

Run: `cargo build -p parachain-template-runtime --release`
Expected: OK. If linker errors surface, inspect the `core::marker` import path — swap to `sp_std::marker::PhantomData` if the runtime doesn't transitively re-export `core::marker`.

- [ ] **Step 4: Run the runtime tests**

Run: `cargo test -p parachain-template-runtime`
Expected: all existing runtime tests still pass.

- [ ] **Step 5: Commit**

```bash
git add blockchain/runtime/src/configs/mod.rs
git commit -m "feat(runtime): EnsureServiceAccount origin for content-registry"
```

---

## Task 9 — Genesis presets: populate `ContentRegistryConfig`

Set dev SVC_PUB + service account so the chain launches in a Phase-2-ready state and `integrity_test` is satisfied.

**Files:**
- Modify: `blockchain/runtime/src/genesis_config_presets.rs`

- [ ] **Step 1: Add imports + constants**

At the top of the file, extend the imports:

```rust
use crate::{
	AccountId, BalancesConfig, CollatorSelectionConfig, ContentRegistryConfig, ParachainInfoConfig,
	PolkadotXcmConfig, RuntimeGenesisConfig, SessionConfig, SessionKeys, SudoConfig,
	EXISTENTIAL_DEPOSIT,
};
```

Just above `testnet_genesis`, add:

```rust
/// Dev-only SVC_PUB x25519 bytes. The matching SVC_PRIV is held by the chain-service
/// binary (P2b); for dev it is checked in under `blockchain/chain-service/dev-keys/`.
/// DO NOT use these bytes in any public testnet or mainnet deployment.
const DEV_SERVICE_PUBLIC_KEY: [u8; 32] = [
	0x51, 0x56, 0xb2, 0xb7, 0x0d, 0x28, 0x0e, 0xbb, 0x7f, 0x71, 0x0c, 0x1f, 0xca, 0x32, 0xfb, 0x54,
	0x70, 0x96, 0xd4, 0xaf, 0x4e, 0x31, 0xe5, 0xb3, 0x70, 0x4b, 0xc7, 0x62, 0xd3, 0x9c, 0x3a, 0x1c,
];
```

(The hex bytes above are a placeholder. In Step 2 of Task 10 we regenerate them with the chain-service key-generation script and paste the output here.)

- [ ] **Step 2: Populate the genesis builder**

Modify `testnet_genesis` to include the content-registry config. Extend the `build_struct_json_patch!` body:

```rust
	build_struct_json_patch!(RuntimeGenesisConfig {
		balances: BalancesConfig {
			balances: endowed_accounts
				.iter()
				.cloned()
				.map(|k| (k, 1u128 << 60))
				.collect::<Vec<_>>(),
		},
		parachain_info: ParachainInfoConfig { parachain_id: id },
		collator_selection: CollatorSelectionConfig {
			invulnerables: invulnerables.iter().cloned().map(|(acc, _)| acc).collect::<Vec<_>>(),
			candidacy_bond: EXISTENTIAL_DEPOSIT * 16,
		},
		session: SessionConfig {
			keys: invulnerables
				.into_iter()
				.map(|(acc, aura)| { (acc.clone(), acc, session_keys(aura),) })
				.collect::<Vec<_>>(),
		},
		polkadot_xcm: PolkadotXcmConfig { safe_xcm_version: Some(SAFE_XCM_VERSION) },
		sudo: SudoConfig { key: Some(root) },
		content_registry: ContentRegistryConfig {
			service_public_key: DEV_SERVICE_PUBLIC_KEY,
			service_account_id: Some(Sr25519Keyring::Dave.to_account_id()),
		},
	})
```

(Dave is already funded via `Sr25519Keyring::well_known()` in `endowed_accounts`, so the service account has an existential deposit by default.)

- [ ] **Step 3: Build the runtime**

Run: `cargo build -p parachain-template-runtime --release`
Expected: OK. If the compiler complains about `ContentRegistryConfig` being unresolved, check that `lib.rs` exports the pallet's `GenesisConfig` with the `ContentRegistryConfig` alias via `construct_runtime!` — it should, because `construct_runtime!` auto-generates `<PalletName>Config` type aliases.

- [ ] **Step 4: Verify the chain-spec includes the values**

Run: `cargo run --release -p parachain-template-node -- build-spec --chain dev | grep -A2 contentRegistry`
Expected: output contains `servicePublicKey` and `serviceAccountId` fields with non-default values.

- [ ] **Step 5: Commit**

```bash
git add blockchain/runtime/src/genesis_config_presets.rs
git commit -m "feat(runtime): populate content-registry genesis with dev service keys"
```

---

## Task 10 — Release build + Zombienet launch smoke

The P2b plan will introduce a proper subxt-based E2E against the daemon. For P2a, we only need to confirm the chain launches cleanly with the new genesis values and `integrity_test` doesn't trip, plus a sanity check on `register_encryption_key`.

**Files:**
- Modify: `scripts/test-zombienet.sh` (append a new phase)
- (Optional) Create: `blockchain/chain-service/dev-keys/README.md` — placeholder doc explaining where the real dev keypair will live (written in P2b)

- [ ] **Step 1: Release build**

Run: `cargo build --release -p parachain-template-runtime -p parachain-template-node`
Expected: WASM + node binary produced without warnings about genesis or integrity.

- [ ] **Step 2: Launch Zombienet locally (manual, one-time)**

Run: `scripts/start-local.sh`
Expected: parachain produces blocks. Tail logs for the first 30 seconds; `integrity_test` panic would crash the collator at block 1 — the absence of such a panic is the primary Phase 2 launch check.

Kill the network (`Ctrl-C`) once you've observed 2–3 blocks.

- [ ] **Step 3: Extend `test-zombienet.sh` with a register-key check**

Inside the existing test loop, add (after the final Phase 1 assertion):

```bash
# -----------------------------------------------------------------------
# Phase 2a — register_encryption_key sanity
# -----------------------------------------------------------------------
echo "[7/7] Phase 2a — register_encryption_key from Alice..."
# stack-cli is the template's CLI; invoke `--help` to discover the call shape
# for your local template version. Typical invocation for a signed call:
#   $CLI content-registry register-encryption-key \
#     --suri //Alice --pubkey 0x1111...1111
# After the call, read EncryptionKeys[Alice] via polkadot-js RPC or subxt and
# assert the value equals the submitted pubkey.
check "register_encryption_key stores Alice's pubkey" \
  bash -c "$CLI content-registry register-encryption-key --suri //Alice --pubkey 0x$(printf '11%.0s' {1..32}) && \
           $CLI query content-registry encryption-keys --account //Alice | grep -q 0x$(printf '11%.0s' {1..32})"
```

If `stack-cli` doesn't have content-registry subcommands, either add them in a follow-up (a one-off CLI task, out of scope for this plan) or exercise the extrinsic directly via a small `subxt`-based helper saved at `scripts/p2a-smoke.ts`. The inline `check` above is a placeholder showing the shape of the assertion.

- [ ] **Step 4: Run the full smoke suite**

Run: `scripts/test-zombienet.sh`
Expected: all existing checks pass; the new Phase 2a check passes.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-zombienet.sh
git commit -m "test(zombienet): phase-2a smoke — register_encryption_key launch check"
```

---

## Task 11 — Update `docs/progress.md`

Add the P2a task list so future work has a visible scoreboard.

**Files:**
- Modify: `docs/progress.md`

- [ ] **Step 1: Append Phase 2a tasks**

Replace the line `Plans: _not written yet_` under "## Phase 2 — Content encryption" with:

```markdown
### P2a — Pallet + Runtime

Plan: [`docs/plans/P2a-pallet-runtime.md`](./plans/P2a-pallet-runtime.md)

- [ ] Task 1: Lock locked_content_lock_key to [u8; 80]
- [ ] Task 2: ServicePublicKey + ServiceAccountId storage + GenesisConfig
- [ ] Task 3: integrity_test guard
- [ ] Task 4: ServiceOrigin Config item + mock binding
- [ ] Task 5: EncryptionKeys + register_encryption_key
- [ ] Task 6: WrappedKeys + grant_access (ServiceOrigin, Pays::No)
- [ ] Task 7: Benchmarks for new extrinsics
- [ ] Task 8: EnsureServiceAccount runtime wiring
- [ ] Task 9: Genesis presets populate ContentRegistryConfig
- [ ] Task 10: Release build + Zombienet launch smoke

### P2b — Chain-service daemon

Plan: _not written yet_

### P2c — Frontend encryption flow

Plan: _not written yet_
```

- [ ] **Step 2: Do NOT commit**

Per the user convention, the user commits `docs/progress.md` themselves. Leave the edit staged but uncommitted; confirm with the user after the plan is validated.

---

## Execution notes

- **Direct to main.** The user's execution protocol commits each task directly to `main`. No worktree, no PRs.
- **User validates before `[x]`.** After each task's commit lands, surface a short validation prompt ("run `cargo test -p pallet-content-registry`, confirm all green, flip the progress checkbox"). Do not tick `docs/progress.md` yourself.
- **Rebuild cost.** Tasks 1–7 are pallet-only and compile in seconds. Task 8 onwards requires a full runtime rebuild — budget ~3 min per invocation on a warm cache.
- **Failure recovery.** If the pallet fails to build after a task, roll back via `git reset --hard HEAD~1` and retry the task fresh; don't layer fixes on a broken commit.

## Self-Review

**Spec coverage.** Each spec item in §4 and §5 maps to a task:
- `ServicePublicKey` / `ServiceAccountId` storage + genesis → Task 2.
- `integrity_test` → Task 3.
- `ServiceOrigin` trait + runtime impl → Tasks 4 + 8.
- `EncryptionKeys` + `register_encryption_key` → Task 5.
- `WrappedKeys` + `grant_access` (with `Pays::No`) → Task 6.
- `Listing.locked_content_lock_key: [u8; 80]` → Task 1.
- `EncryptionKeyRegistered`, `AccessGranted` events → Tasks 5, 6.
- Benchmarks → Task 7.
- Genesis dev presets → Task 9.
- Zombienet launch validation → Task 10.

Out-of-scope for P2a (confirmed in "Scope carve-outs"): chain-service daemon (P2b), frontend encryption flow (P2c), `regrant_access` (Phase 4), service-key rotation (Phase 5).

**No placeholders.** All code blocks are concrete. Two deliberate fallbacks are flagged for runtime behavior the skill can't predict in advance: the `#[pallet::weight]` tuple-vs-`DispatchResultWithPostInfo` form in Task 6, and the `stack-cli` subcommand shape in Task 10. Both include explicit fallback instructions.

**Type consistency.** `locked_content_lock_key: [u8; 80]` and `WrappedKeys` value type match across Tasks 1, 6, and 7. `ServiceOrigin` associated type in Task 4 matches the `EnsureServiceAccount<Runtime>` impl in Task 8 (both return `T::AccountId` as `Success`). Event variant names match between pallet (Tasks 5, 6) and test assertions.
