use crate::mock::*;
use frame::testing_prelude::*;

#[test]
fn mock_runtime_builds() {
	new_test_ext().execute_with(|| {
		assert_eq!(Balances::free_balance(ALICE), 1_000_000);
		assert_eq!(Balances::free_balance(BOB), 1_000_000);
	});
}
