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
