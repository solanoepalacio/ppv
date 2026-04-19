//! Benchmarking setup for pallet-content-registry.

#![cfg(feature = "runtime-benchmarks")]

use alloc::vec;

use super::*;
use frame::traits::Currency;
use frame::{deps::frame_benchmarking::v2::*, prelude::*};
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

		assert!(Purchases::<T>::contains_key(0u64, &buyer));
	}

	impl_benchmark_test_suite!(ContentRegistry, crate::mock::new_test_ext(), crate::mock::Test);
}
