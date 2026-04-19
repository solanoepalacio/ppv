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
