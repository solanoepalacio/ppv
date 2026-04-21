use ppview_content_unlock_service::chain::signer_from_suri;

#[test]
fn signer_from_suri_accepts_dev_account() {
    let dave = signer_from_suri("//Dave").unwrap();
    // Sr25519 public key must be 32 bytes.
    assert_eq!(dave.public_key().0.len(), 32);
}

#[test]
fn signer_from_suri_rejects_garbage() {
    assert!(signer_from_suri("not a uri ///").is_err());
}
