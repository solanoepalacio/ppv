use ppview_content_unlock_service::keys::load_svc_priv;
use std::path::Path;

#[test]
fn load_svc_priv_reads_pkcs8_pem_and_derives_pubkey() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/svc_priv_sample.pem");
    let secret = load_svc_priv(&fixture).expect("fixture must parse");

    // Derive the public key the same way consumers will — via x25519 scalar mul.
    let public: crypto_box::PublicKey = secret.public_key();

    let expected_pub_hex = "5412e736c6ca82391373c9d1a8d38eba178803eb6f169f306ea3e449a9002e1c";
    assert_eq!(hex::encode(public.as_bytes()), expected_pub_hex);
}

#[test]
fn load_svc_priv_rejects_nonexistent_path() {
    let err = load_svc_priv(std::path::Path::new("/does/not/exist.pem"))
        .expect_err("missing file must error");
    let msg = format!("{err:#}");
    assert!(msg.contains("/does/not/exist.pem"), "error should name the path: {msg}");
}

#[test]
fn load_svc_priv_rejects_non_x25519_pem() {
    let tmp = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(tmp.path(), "not a pem file").unwrap();
    assert!(load_svc_priv(tmp.path()).is_err());
}
