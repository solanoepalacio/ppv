extern crate alloc;

use frame::{
	deps::{frame_support::weights::constants::RocksDbWeight, frame_system::GenesisConfig},
	prelude::*,
	runtime::prelude::*,
	testing_prelude::*,
	traits::SortedMembers,
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
	type Lookup = frame::traits::IdentityLookup<AccountId>;
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
	type ServiceOrigin = EnsureSignedBy<ServiceMember, AccountId>;
	type WeightInfo = ();
}

pub const ALICE: AccountId = 1;
pub const BOB: AccountId = 2;
pub const CHARLIE: AccountId = 3;
pub const SERVICE: AccountId = 99;
pub const SVC_PUB_DEV: [u8; 32] = [0xAAu8; 32];

pub struct ServiceMember;
impl SortedMembers<AccountId> for ServiceMember {
	fn sorted_members() -> alloc::vec::Vec<AccountId> {
		alloc::vec![SERVICE]
	}
	fn contains(who: &AccountId) -> bool {
		who == &SERVICE
	}
	fn count() -> usize {
		1
	}
}

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
