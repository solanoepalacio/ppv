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
