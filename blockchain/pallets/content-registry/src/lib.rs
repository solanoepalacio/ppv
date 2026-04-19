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

	#[pallet::event]
	#[pallet::generate_deposit(pub(super) fn deposit_event)]
	pub enum Event<T: Config> {}

	#[pallet::error]
	pub enum Error<T> {}

	#[pallet::call]
	impl<T: Config> Pallet<T> {}
}
