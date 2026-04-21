use anyhow::{anyhow, Context, Result};
use std::fs;
use std::path::Path;
use subxt_signer::sr25519::Keypair;

use crate::chain::signer_from_suri;

/// Read the sr25519 service-signer SURI from `path` and build a Keypair.
///
/// The file is expected to contain a single SURI — either a raw 32-byte hex
/// seed (`0x<64 hex chars>`) or a derivation path like `//Alice`. Trailing
/// whitespace is tolerated. `scripts/gen-service-key.sh` writes a random hex
/// seed with the correct format and chmod 600.
pub fn load_signer(path: &Path) -> Result<Keypair> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("reading signer SURI from {}", path.display()))?;
    let suri = raw.trim();
    if suri.is_empty() {
        return Err(anyhow!("{}: empty SURI file", path.display()));
    }
    signer_from_suri(suri).with_context(|| format!("parsing SURI from {}", path.display()))
}
