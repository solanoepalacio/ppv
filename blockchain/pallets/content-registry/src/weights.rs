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
	fn register_encryption_key() -> Weight;
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

	fn register_encryption_key() -> Weight {
		Weight::from_parts(15_000_000, 1_000)
			.saturating_add(T::DbWeight::get().writes(1))
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

	fn register_encryption_key() -> Weight {
		Weight::from_parts(15_000_000, 1_000)
			.saturating_add(RocksDbWeight::get().writes(1))
	}
}
