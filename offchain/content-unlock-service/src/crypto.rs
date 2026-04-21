//! NaCl sealed-box wrappers. Wire format: 32-byte ephemeral pubkey ‖
//! 32-byte ciphertext ‖ 16-byte Poly1305 MAC = 80 bytes total, identical
//! to TweetNaCl's `crypto_box_seal` (used on the browser side).

use anyhow::{anyhow, Result};
use crypto_box::{aead::rand_core::OsRng, PublicKey, SecretKey};

/// Seal a 32-byte content-lock-key to `recipient`. Returns the 80-byte
/// concatenation `ephem_pub ‖ ciphertext ‖ MAC`.
pub fn seal_to(recipient: &PublicKey, plaintext: &[u8; 32]) -> Result<[u8; 80]> {
    let sealed = recipient
        .seal(&mut OsRng, plaintext)
        .map_err(|e| anyhow!("crypto_box seal failed: {e}"))?;
    if sealed.len() != 80 {
        return Err(anyhow!(
            "sealed-box output length {} (expected 80)",
            sealed.len()
        ));
    }
    let mut out = [0u8; 80];
    out.copy_from_slice(&sealed);
    Ok(out)
}

/// Unseal an 80-byte sealed-box into its original 32-byte plaintext.
pub fn unseal_from(recipient_secret: &SecretKey, sealed: &[u8]) -> Result<[u8; 32]> {
    if sealed.len() != 80 {
        return Err(anyhow!(
            "sealed-box input length {} (expected 80)",
            sealed.len()
        ));
    }
    let plaintext = recipient_secret
        .unseal(sealed)
        .map_err(|e| anyhow!("crypto_box unseal failed (wrong key or tampered ciphertext?): {e}"))?;
    if plaintext.len() != 32 {
        return Err(anyhow!(
            "unsealed payload length {} (expected 32)",
            plaintext.len()
        ));
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&plaintext);
    Ok(out)
}
