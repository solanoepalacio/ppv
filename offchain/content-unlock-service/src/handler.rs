use anyhow::{anyhow, Context, Result};
use crypto_box::{PublicKey, SecretKey};
use subxt_signer::sr25519::Keypair;
use tracing::{info, warn};

use crate::chain::{AccountId32, Chain};
use crate::crypto::{seal_to, unseal_from};

/// Why did we receive this target? Drives log labeling only; the wrap-and-grant
/// path is identical for both.
#[derive(Debug, Clone, Copy)]
pub enum TargetKind {
    Buyer,
    Creator,
}

/// One wrap-and-grant job. Fetches the listing's sealed key, unseals with
/// SVC_PRIV, re-seals to the target's registered x25519 pubkey, submits
/// `grant_access`. Skips if already granted.
pub async fn wrap_and_grant(
    chain: &Chain,
    signer: &Keypair,
    svc_priv: &SecretKey,
    listing_id: u64,
    target: &AccountId32,
    kind: TargetKind,
) -> Result<()> {
    // Idempotency: already granted?
    if chain.wrapped_key(target, listing_id).await?.is_some() {
        info!(listing_id, %target, ?kind, "WrappedKeys entry already present — skipping");
        return Ok(());
    }

    let sealed_for_service = chain
        .listing_locked_key(listing_id)
        .await?
        .ok_or_else(|| anyhow!("listing {listing_id} not found on chain"))?;

    let Some(target_pub_bytes) = chain.encryption_key(target).await? else {
        // This is the one case where we can't proceed — the target hasn't
        // registered an encryption key. Per spec §4 Batched first-write UX,
        // this should be impossible for both buyers and creators because the
        // first `purchase` / `create_listing` is batched with
        // `register_encryption_key`. Log loudly and skip — don't retry, since
        // nothing on-chain is going to change until the target acts.
        warn!(
            listing_id,
            %target,
            ?kind,
            "EncryptionKeys[target] missing — the creator/buyer skipped the batch? skipping event"
        );
        return Ok(());
    };

    let plaintext_clk = unseal_from(svc_priv, &sealed_for_service)
        .context("unsealing locked_content_lock_key with SVC_PRIV")?;

    let target_pub = PublicKey::from(target_pub_bytes);
    let sealed_for_target =
        seal_to(&target_pub, &plaintext_clk).context("sealing to target pubkey")?;

    let tx_hash = chain
        .submit_grant_access(signer, listing_id, target, &sealed_for_target)
        .await
        .context("submitting grant_access")?;

    info!(listing_id, %target, ?kind, tx = %hex::encode(tx_hash.0), "grant_access finalized");
    Ok(())
}
