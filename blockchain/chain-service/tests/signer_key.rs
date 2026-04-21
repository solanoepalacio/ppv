use ppview_chain_service::signer_key::load_signer;
use std::io::Write;

fn write_tmp(content: &str) -> tempfile::NamedTempFile {
    let mut f = tempfile::NamedTempFile::new().unwrap();
    f.write_all(content.as_bytes()).unwrap();
    f.flush().unwrap();
    f
}

#[test]
fn accepts_dev_derivation_path() {
    let f = write_tmp("//Alice\n");
    let kp = load_signer(f.path()).unwrap();
    assert_eq!(kp.public_key().0.len(), 32);
}

#[test]
fn accepts_raw_hex_seed() {
    // 32-byte fixed seed — lets the test pin the derived pubkey.
    let f = write_tmp("0x7c0fed9b8cc3a05f8c2b2123f33b1c0ea57b61c4b4cc2d2e2d1b0a09080706f5");
    let kp = load_signer(f.path()).unwrap();
    assert_eq!(kp.public_key().0.len(), 32);
    // Pubkey is deterministic from the seed — make sure repeat loads are stable.
    let kp2 = load_signer(f.path()).unwrap();
    assert_eq!(kp.public_key().0, kp2.public_key().0);
}

#[test]
fn tolerates_trailing_whitespace() {
    let f = write_tmp("//Bob\n\n   \t");
    let kp = load_signer(f.path()).unwrap();
    assert_eq!(kp.public_key().0.len(), 32);
}

#[test]
fn rejects_empty_file() {
    let f = write_tmp("   \n\t");
    let err = load_signer(f.path()).unwrap_err();
    let msg = format!("{err:#}");
    assert!(msg.contains("empty SURI file"), "unexpected error: {msg}");
}

#[test]
fn rejects_missing_file() {
    let err = load_signer(std::path::Path::new("/does/not/exist.suri")).unwrap_err();
    let msg = format!("{err:#}");
    assert!(msg.contains("/does/not/exist.suri"), "error should name path: {msg}");
}
