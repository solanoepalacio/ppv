use crypto_box::{PublicKey, SecretKey};
use ppview_chain_service::crypto::{seal_to, unseal_from};

#[test]
fn seal_unseal_roundtrip() {
    // Fixed-seed secret to make the test deterministic on the target side.
    let target_secret = SecretKey::from([7u8; 32]);
    let target_public: PublicKey = target_secret.public_key();

    let content_lock_key = [0xABu8; 32];
    let sealed = seal_to(&target_public, &content_lock_key).unwrap();
    assert_eq!(sealed.len(), 80, "sealed-box output must be exactly 80 bytes");

    let opened = unseal_from(&target_secret, &sealed).unwrap();
    assert_eq!(opened, content_lock_key);
}

#[test]
fn unseal_from_wrong_key_fails() {
    let right = SecretKey::from([7u8; 32]);
    let wrong = SecretKey::from([8u8; 32]);
    let sealed = seal_to(&right.public_key(), &[0x11u8; 32]).unwrap();
    assert!(unseal_from(&wrong, &sealed).is_err());
}

#[test]
fn unseal_rejects_wrong_length_input() {
    let sk = SecretKey::from([7u8; 32]);
    assert!(unseal_from(&sk, &[0u8; 79]).is_err());
    assert!(unseal_from(&sk, &[0u8; 81]).is_err());
}
