//! # Content Registry Pallet
//!
//! Stores pay-per-view listings and records purchases. Native-token payment is
//! transferred from buyer to creator as part of `purchase`.
//! Holds a content-lock-key sealed to the service pubkey.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

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
		deps::sp_runtime::traits::Zero,
		prelude::*,
		traits::{Currency, ExistenceRequirement},
	};

	pub type BalanceOf<T> =
		<<T as Config>::Currency as Currency<<T as frame_system::Config>::AccountId>>::Balance;

	pub type ListingId = u64;

	#[pallet::pallet]
	pub struct Pallet<T>(_);

	#[pallet::hooks]
	impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T> {
		fn integrity_test() {
			assert!(
				ServicePublicKey::<T>::get() != [0u8; 32],
				"ServicePublicKey was left at [0; 32] — the chain-spec forgot to populate the content-registry GenesisConfig.",
			);
			assert!(
				ServiceAccountId::<T>::get().is_some(),
				"ServiceAccountId is unset — the chain-spec forgot to populate the content-registry GenesisConfig.",
			);
		}
	}

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
	#[derive(
		Encode,
		Decode,
		DecodeWithMemTracking,
		Clone,
		Copy,
		PartialEq,
		Eq,
		RuntimeDebug,
		TypeInfo,
		MaxEncodedLen,
	)]
	pub struct BulletinCid {
		pub codec: u8,
		pub digest: [u8; 32],
	}

	/// A published content listing.
	#[derive(Encode, Decode, Clone, PartialEq, Eq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
	#[scale_info(skip_type_params(T))]
	pub struct Listing<T: Config> {
		/// Account that published the listing and receives payment.
		pub creator: T::AccountId,
		/// Flat price in native token.
		pub price: BalanceOf<T>,
		/// Content CID on Bulletin Chain
		pub content_cid: BulletinCid,
		/// CID of the auto-extracted thumbnail on Bulletin. Always unencrypted
		pub thumbnail_cid: BulletinCid,
		/// blake2b-256 of plaintext. Buyer frontend verifies after decryption.
		pub content_hash: [u8; 32],
		/// Display title.
		pub title: BoundedVec<u8, ConstU32<128>>,
		/// Display description.
		pub description: BoundedVec<u8, ConstU32<2048>>,
		/// Fixed 80 bytes = 32-byte ephemeral pubkey ‖ 32-byte ciphertext ‖ 16-byte MAC.
		pub locked_content_lock_key: [u8; 80],
		/// Block number the listing was created at.
		pub created_at: BlockNumberFor<T>,
	}

	#[pallet::storage]
	pub type NextListingId<T: Config> = StorageValue<_, ListingId, ValueQuery>;

	#[pallet::storage]
	pub type Listings<T: Config> =
		StorageMap<_, Blake2_128Concat, ListingId, Listing<T>, OptionQuery>;

	/// Records each buyer's purchases, keyed (buyer, listing_id). Value is
	/// the block number the purchase was completed at — used by the frontend's
	/// "My Purchases" view to sort the buyer's library by purchase time.
	#[pallet::storage]
	pub type Purchases<T: Config> = StorageDoubleMap<
		_,
		Blake2_128Concat,
		T::AccountId,
		Blake2_128Concat,
		ListingId,
		BlockNumberFor<T>,
		OptionQuery,
	>;

	/// SVC_PUB (x25519) — published for creators to seal content-lock-keys against.
	/// Genesis-set, immutable. `integrity_test` rejects `[0u8; 32]`.
	#[pallet::storage]
	pub type ServicePublicKey<T: Config> = StorageValue<_, [u8; 32], ValueQuery>;

	/// sr25519 AccountId authorized to call `grant_access`. Genesis-set, immutable.
	/// `integrity_test` rejects the unset (`None`) case.
	#[pallet::storage]
	pub type ServiceAccountId<T: Config> = StorageValue<_, T::AccountId, OptionQuery>;

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

	#[pallet::event]
	#[pallet::generate_deposit(pub(super) fn deposit_event)]
	pub enum Event<T: Config> {
		ListingCreated { listing_id: ListingId, creator: T::AccountId, price: BalanceOf<T> },
		PurchaseCompleted { listing_id: ListingId, buyer: T::AccountId, creator: T::AccountId },
	}

	#[pallet::error]
	pub enum Error<T> {
		/// The listing ID counter overflowed `u64::MAX`.
		ListingIdOverflow,
		/// Listings must have a positive price.
		ZeroPrice,
		/// No listing exists for the given ID.
		ListingNotFound,
		/// Creators cannot purchase their own listings.
		BuyerIsCreator,
		/// This buyer has already purchased this listing.
		AlreadyPurchased,
	}

	#[pallet::call]
	impl<T: Config> Pallet<T> {
		#[pallet::call_index(0)]
		#[pallet::weight(T::WeightInfo::create_listing())]
		pub fn create_listing(
			origin: OriginFor<T>,
			content_cid: BulletinCid,
			thumbnail_cid: BulletinCid,
			content_hash: [u8; 32],
			title: BoundedVec<u8, ConstU32<128>>,
			description: BoundedVec<u8, ConstU32<2048>>,
			price: BalanceOf<T>,
			locked_content_lock_key: [u8; 80],
		) -> DispatchResult {
			let creator = ensure_signed(origin)?;

			ensure!(!price.is_zero(), Error::<T>::ZeroPrice);

			let listing_id = NextListingId::<T>::get();
			let next = listing_id.checked_add(1).ok_or(Error::<T>::ListingIdOverflow)?;

			let listing = Listing::<T> {
				creator: creator.clone(),
				price,
				content_cid,
				thumbnail_cid,
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

		#[pallet::call_index(1)]
		#[pallet::weight(T::WeightInfo::purchase())]
		pub fn purchase(origin: OriginFor<T>, listing_id: ListingId) -> DispatchResult {
			let buyer = ensure_signed(origin)?;
			let listing = Listings::<T>::get(listing_id).ok_or(Error::<T>::ListingNotFound)?;

			ensure!(buyer != listing.creator, Error::<T>::BuyerIsCreator);
			ensure!(
				!Purchases::<T>::contains_key(&buyer, listing_id),
				Error::<T>::AlreadyPurchased,
			);

			T::Currency::transfer(
				&buyer,
				&listing.creator,
				listing.price,
				ExistenceRequirement::KeepAlive,
			)?;

			let now = frame_system::Pallet::<T>::block_number();
			Purchases::<T>::insert(&buyer, listing_id, now);

			Self::deposit_event(Event::PurchaseCompleted {
				listing_id,
				buyer,
				creator: listing.creator,
			});
			Ok(())
		}
	}
}
