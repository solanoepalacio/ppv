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

use crate::pallet::Purchases;

#[test]
fn purchases_storage_roundtrip() {
	new_test_ext().execute_with(|| {
		Purchases::<Test>::insert(0u64, BOB, ());
		assert!(Purchases::<Test>::contains_key(0u64, BOB));
		assert!(!Purchases::<Test>::contains_key(0u64, ALICE));
	});
}

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
		assert!(Purchases::<Test>::contains_key(listing_id, BOB));

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
fn create_listing_fails_on_id_overflow() {
	new_test_ext().execute_with(|| {
		NextListingId::<Test>::put(u64::MAX);
		assert_noop!(
			ContentRegistry::create_listing(
				RuntimeOrigin::signed(ALICE),
				sample_cid(),
				[0x33u8; 32],
				bvec::<128>(b"t"),
				bvec::<2048>(b"d"),
				500,
				bvec::<128>(&[]),
			),
			crate::Error::<Test>::ListingIdOverflow,
		);
	});
}
