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
