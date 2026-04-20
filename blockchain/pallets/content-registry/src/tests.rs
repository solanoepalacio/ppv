use crate::mock::*;
use crate::pallet::BulletinCid;
use codec::{Decode, Encode};
use frame::testing_prelude::*;

#[test]
fn mock_runtime_builds() {
	new_test_ext().execute_with(|| {
		assert_eq!(Balances::free_balance(ALICE), 1_000_000);
		assert_eq!(Balances::free_balance(BOB), 1_000_000);
	});
}

#[test]
fn bulletin_cid_scale_roundtrip() {
	let cid = BulletinCid { codec: 0x55, digest: [0xabu8; 32] };
	let encoded = cid.encode();
	let decoded = BulletinCid::decode(&mut &encoded[..]).unwrap();
	assert_eq!(decoded.codec, 0x55);
	assert_eq!(decoded.digest, [0xabu8; 32]);
}

use crate::pallet::{Listing, Listings, NextListingId};

#[test]
fn listings_storage_roundtrip() {
	new_test_ext().execute_with(|| {
		assert_eq!(NextListingId::<Test>::get(), 0);

		let listing = Listing::<Test> {
			creator: ALICE,
			price: 100,
			content_cid: BulletinCid { codec: 0x55, digest: [0x11u8; 32] },
			thumbnail_cid: BulletinCid { codec: 0x55, digest: [0xccu8; 32] },
			content_hash: [0x22u8; 32],
			title: b"hello".to_vec().try_into().unwrap(),
			description: b"world".to_vec().try_into().unwrap(),
			locked_content_lock_key: [0u8; 80],
			created_at: 0,
		};
		Listings::<Test>::insert(0u64, listing.clone());

		let read = Listings::<Test>::get(0u64).unwrap();
		assert_eq!(read.creator, ALICE);
		assert_eq!(read.price, 100);
		assert_eq!(read.content_hash, [0x22u8; 32]);
	});
}

fn sample_cid() -> BulletinCid {
	BulletinCid { codec: 0x55, digest: [0xaau8; 32] }
}

fn sample_thumb_cid() -> BulletinCid {
	BulletinCid { codec: 0x55, digest: [0xccu8; 32] }
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
			sample_thumb_cid(),
			[0x33u8; 32],
			bvec::<128>(b"cool pdf"),
			bvec::<2048>(b"a book i wrote"),
			500,
			[0u8; 80],
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

#[test]
fn create_listing_fails_if_price_zero() {
	new_test_ext().execute_with(|| {
		assert_noop!(
			ContentRegistry::create_listing(
				RuntimeOrigin::signed(ALICE),
				sample_cid(),
				sample_thumb_cid(),
				[0x33u8; 32],
				bvec::<128>(b"free"),
				bvec::<2048>(b""),
				0,
				[0u8; 80],
			),
			crate::Error::<Test>::ZeroPrice,
		);
	});
}

use crate::pallet::Purchases;

#[test]
fn purchases_storage_roundtrip() {
	new_test_ext().execute_with(|| {
		Purchases::<Test>::insert(BOB, 0u64, 5u64);
		assert_eq!(Purchases::<Test>::get(BOB, 0u64), Some(5));
		assert_eq!(Purchases::<Test>::get(ALICE, 0u64), None);
	});
}

fn seed_listing(creator: AccountId, price: Balance) -> u64 {
	assert_ok!(ContentRegistry::create_listing(
		RuntimeOrigin::signed(creator),
		sample_cid(),
		sample_thumb_cid(),
		[0x33u8; 32],
		bvec::<128>(b"t"),
		bvec::<2048>(b"d"),
		price,
		[0u8; 80],
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
		assert_eq!(Purchases::<Test>::get(BOB, listing_id), Some(10));

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

#[test]
fn purchase_fails_if_buyer_cannot_afford_it() {
	new_test_ext().execute_with(|| {
		// CHARLIE starts with 500; a 1000-price listing exceeds the keep-alive headroom.
		let listing_id = seed_listing(ALICE, 1_000);
		// The error here originates in pallet-balances, not ours, so naming the
		// variant is awkward. assert_noop! would be stronger (asserts the whole
		// storage root is unchanged) — this is a deliberate, weaker check.
		assert!(ContentRegistry::purchase(RuntimeOrigin::signed(CHARLIE), listing_id).is_err());
		assert_eq!(Purchases::<Test>::get(CHARLIE, listing_id), None);
	});
}

#[test]
fn purchase_fails_if_listing_missing() {
	new_test_ext().execute_with(|| {
		assert_noop!(
			ContentRegistry::purchase(RuntimeOrigin::signed(BOB), 42),
			crate::Error::<Test>::ListingNotFound,
		);
	});
}

#[test]
fn create_listing_fails_on_id_overflow() {
	new_test_ext().execute_with(|| {
		NextListingId::<Test>::put(u64::MAX);
		assert_noop!(
			ContentRegistry::create_listing(
				RuntimeOrigin::signed(ALICE),
				sample_cid(),
				sample_thumb_cid(),
				[0x33u8; 32],
				bvec::<128>(b"t"),
				bvec::<2048>(b"d"),
				500,
				[0u8; 80],
			),
			crate::Error::<Test>::ListingIdOverflow,
		);
	});
}

use crate::pallet::{ServiceAccountId, ServicePublicKey};

#[test]
fn service_keys_are_set_from_genesis() {
	new_test_ext().execute_with(|| {
		assert_eq!(ServicePublicKey::<Test>::get(), [0xAAu8; 32]);
		assert_eq!(ServiceAccountId::<Test>::get(), Some(SERVICE));
	});
}

#[test]
#[should_panic(expected = "ServicePublicKey")]
fn on_initialize_block_one_panics_on_zero_service_pubkey() {
	new_test_ext().execute_with(|| {
		ServicePublicKey::<Test>::put([0u8; 32]);
		<crate::pallet::Pallet<Test> as frame::traits::Hooks<u64>>::on_initialize(1);
	});
}

#[test]
#[should_panic(expected = "ServiceAccountId")]
fn on_initialize_block_one_panics_on_unset_service_account() {
	new_test_ext().execute_with(|| {
		ServiceAccountId::<Test>::kill();
		<crate::pallet::Pallet<Test> as frame::traits::Hooks<u64>>::on_initialize(1);
	});
}

#[test]
fn on_initialize_block_one_passes_with_valid_genesis() {
	new_test_ext().execute_with(|| {
		<crate::pallet::Pallet<Test> as frame::traits::Hooks<u64>>::on_initialize(1);
	});
}

#[test]
fn on_initialize_other_blocks_noop_even_when_storage_bad() {
	new_test_ext().execute_with(|| {
		ServicePublicKey::<Test>::put([0u8; 32]);
		ServiceAccountId::<Test>::kill();
		// Any block != 1 should be a no-op; this must not panic.
		<crate::pallet::Pallet<Test> as frame::traits::Hooks<u64>>::on_initialize(2);
	});
}

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
			RuntimeOrigin::signed(BOB),
			[0x11u8; 32],
		));
		assert_ok!(ContentRegistry::register_encryption_key(
			RuntimeOrigin::signed(BOB),
			[0x22u8; 32],
		));
		assert_eq!(EncryptionKeys::<Test>::get(BOB), Some([0x22u8; 32]));
	});
}
