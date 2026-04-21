use anyhow::{anyhow, Context, Result};
use crypto_box::SecretKey;
use std::fs;
use std::path::Path;

/// Load an x25519 private key from a PKCS#8 PEM file (`BEGIN PRIVATE KEY`).
///
/// The file format is the one produced by `scripts/gen-service-key.sh`
/// (`openssl genpkey -algorithm X25519`). PKCS#8 wraps a 32-byte X25519 scalar
/// inside an OCTET STRING at the end of the DER blob; we extract it by parsing
/// the PEM envelope and then taking the final 32 bytes of the DER-encoded
/// `PrivateKeyInfo.privateKey` octet string contents.
pub fn load_svc_priv(path: &Path) -> Result<SecretKey> {
    let pem_bytes =
        fs::read(path).with_context(|| format!("reading SVC_PRIV from {}", path.display()))?;
    let pem = pem::parse(&pem_bytes)
        .with_context(|| format!("parsing PEM envelope in {}", path.display()))?;
    if pem.tag() != "PRIVATE KEY" {
        return Err(anyhow!(
            "{}: unexpected PEM tag `{}` (want `PRIVATE KEY`)",
            path.display(),
            pem.tag()
        ));
    }

    let info = pkcs8::PrivateKeyInfo::try_from(pem.contents())
        .map_err(|e| anyhow!("{}: malformed PKCS#8: {e}", path.display()))?;

    // X25519 OID is 1.3.101.110
    const X25519_OID: pkcs8::ObjectIdentifier = pkcs8::ObjectIdentifier::new_unwrap("1.3.101.110");
    if info.algorithm.oid != X25519_OID {
        return Err(anyhow!(
            "{}: key algorithm is {}, expected X25519 ({X25519_OID})",
            path.display(),
            info.algorithm.oid
        ));
    }

    // `info.private_key` is the OCTET STRING contents of PKCS#8
    // `privateKey`, which for X25519 is itself another OCTET STRING
    // containing 32 raw bytes. `info.private_key` is already the inner
    // bytes after the outer unwrap, but some encoders include the extra
    // 0x04 0x20 prefix — handle both shapes.
    let raw = match info.private_key {
        bytes if bytes.len() == 32 => bytes.to_vec(),
        bytes if bytes.len() == 34 && bytes.starts_with(&[0x04, 0x20]) => bytes[2..].to_vec(),
        bytes => {
            return Err(anyhow!(
                "{}: expected 32- or 34-byte X25519 private-key payload, got {}",
                path.display(),
                bytes.len()
            ))
        }
    };

    let mut buf = [0u8; 32];
    buf.copy_from_slice(&raw);
    Ok(SecretKey::from(buf))
}
