use anyhow::{anyhow, Context, Result};
use crypto_box::SecretKey;
use subxt::dynamic::{At, Value};
use subxt_signer::sr25519::Keypair;
use tracing::{info, warn};

use crate::chain::{AccountId32, Chain};
use crate::handler::{wrap_and_grant, TargetKind};

const PALLET: &str = "ContentRegistry";

/// Iterate every `Listings` entry and every `Purchases` entry on the latest
/// finalized head. For each pair `(creator, listing_id)` and `(buyer,
/// listing_id)`, if `WrappedKeys[(target, listing_id)]` is empty, run the
/// wrap-and-grant flow. Called once at startup before the live stream.
pub async fn backfill(chain: &Chain, signer: &Keypair, svc_priv: &SecretKey) -> Result<()> {
    info!("starting backfill scan");
    let head = chain.inner().storage().at_latest().await?;

    // --- Listings (creator targets) ---
    // Empty `Vec<Value>` key ⇒ prefix-only address ⇒ iterate all entries.
    let listings_query =
        subxt::dynamic::storage(PALLET, "Listings", Vec::<Value>::new());
    let mut stream = head
        .iter(listings_query)
        .await
        .context("starting Listings iteration")?;
    let mut creator_count = 0usize;
    while let Some(kv) = stream.next().await {
        let kv = kv.context("iterating Listings")?;
        let listing_id = listing_id_from_key(&kv.key_bytes)
            .context("decoding Listings key suffix")?;
        let value = kv.value.to_value().context("decoding Listing value")?;
        let Some(creator_val) = value.at("creator") else {
            warn!(listing_id, "Listings entry missing `creator` field — skipping");
            continue;
        };
        let Some(creator_bytes) = crate::chain::value_to_bytes(creator_val) else {
            warn!(listing_id, "Listings[{listing_id}].creator is not a byte array — skipping");
            continue;
        };
        let Some(creator) = account_from_bytes(&creator_bytes) else {
            warn!(
                listing_id,
                len = creator_bytes.len(),
                "Listings creator is not 32 bytes — skipping"
            );
            continue;
        };
        if let Err(e) = wrap_and_grant(
            chain,
            signer,
            svc_priv,
            listing_id,
            &creator,
            TargetKind::Creator,
        )
        .await
        {
            warn!(
                listing_id,
                %creator,
                error = ?e,
                "creator backfill failed — will be retried next startup"
            );
        }
        creator_count += 1;
    }

    // --- Purchases (buyer targets) ---
    let purchases_query =
        subxt::dynamic::storage(PALLET, "Purchases", Vec::<Value>::new());
    let mut stream = head
        .iter(purchases_query)
        .await
        .context("starting Purchases iteration")?;
    let mut buyer_count = 0usize;
    while let Some(kv) = stream.next().await {
        let kv = kv.context("iterating Purchases")?;
        let (buyer, listing_id) =
            purchases_key(&kv.key_bytes).context("decoding Purchases key suffix")?;
        if let Err(e) = wrap_and_grant(
            chain,
            signer,
            svc_priv,
            listing_id,
            &buyer,
            TargetKind::Buyer,
        )
        .await
        {
            warn!(
                listing_id,
                %buyer,
                error = ?e,
                "buyer backfill failed — will be retried next startup"
            );
        }
        buyer_count += 1;
    }

    info!(
        creators = creator_count,
        buyers = buyer_count,
        "backfill scan complete"
    );
    Ok(())
}

/// `Listings` is `StorageMap<Blake2_128Concat, ListingId, Listing>`.
/// Storage key layout: 16-byte twox-128 pallet prefix ‖ 16-byte twox-128 item
/// prefix ‖ 16-byte blake2_128 hash ‖ 8-byte little-endian `u64` listing id.
/// Because the hasher is `_Concat`, the raw listing id is the trailing 8 bytes.
fn listing_id_from_key(key: &[u8]) -> Result<u64> {
    if key.len() < 8 {
        return Err(anyhow!("Listings key too short: {} bytes", key.len()));
    }
    let tail = &key[key.len() - 8..];
    let mut buf = [0u8; 8];
    buf.copy_from_slice(tail);
    Ok(u64::from_le_bytes(buf))
}

/// `Purchases` is `StorageDoubleMap<Blake2_128Concat, AccountId, Blake2_128Concat,
/// ListingId, BlockNumber>`. Key layout: 16-byte twox-128 pallet prefix ‖
/// 16-byte twox-128 item prefix ‖ 16-byte blake2_128 ‖ 32-byte AccountId ‖
/// 16-byte blake2_128 ‖ 8-byte LE u64 listing id.
fn purchases_key(key: &[u8]) -> Result<(AccountId32, u64)> {
    const MIN: usize = 16 + 16 + 16 + 32 + 16 + 8;
    if key.len() < MIN {
        return Err(anyhow!(
            "Purchases key too short: {} bytes (need at least {MIN})",
            key.len()
        ));
    }
    let len = key.len();
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&key[len - 8..]);
    let listing_id = u64::from_le_bytes(buf);
    let account_bytes = &key[len - 8 - 16 - 32..len - 8 - 16];
    let mut acc = [0u8; 32];
    acc.copy_from_slice(account_bytes);
    Ok((subxt::utils::AccountId32(acc), listing_id))
}

fn account_from_bytes(bytes: &[u8]) -> Option<AccountId32> {
    if bytes.len() != 32 {
        return None;
    }
    let mut a = [0u8; 32];
    a.copy_from_slice(bytes);
    Some(subxt::utils::AccountId32(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_listings_key(listing_id: u64) -> Vec<u8> {
        // Prefix bytes are opaque to the decoder — use distinctive filler so a
        // boundary mistake would surface.
        let mut key = Vec::with_capacity(16 + 16 + 16 + 8);
        key.extend(std::iter::repeat(0xAAu8).take(16)); // twox-128 pallet
        key.extend(std::iter::repeat(0xBBu8).take(16)); // twox-128 item
        key.extend(std::iter::repeat(0xCCu8).take(16)); // blake2_128 hash
        key.extend_from_slice(&listing_id.to_le_bytes());
        key
    }

    fn fake_purchases_key(account: [u8; 32], listing_id: u64) -> Vec<u8> {
        let mut key = Vec::with_capacity(16 + 16 + 16 + 32 + 16 + 8);
        key.extend(std::iter::repeat(0xAAu8).take(16));
        key.extend(std::iter::repeat(0xBBu8).take(16));
        key.extend(std::iter::repeat(0xCCu8).take(16));
        key.extend_from_slice(&account);
        key.extend(std::iter::repeat(0xDDu8).take(16));
        key.extend_from_slice(&listing_id.to_le_bytes());
        key
    }

    #[test]
    fn listing_id_from_key_reads_little_endian_tail() {
        for id in [0u64, 1, 42, 1_000_000, u64::MAX] {
            let key = fake_listings_key(id);
            assert_eq!(listing_id_from_key(&key).unwrap(), id, "id {id}");
        }
    }

    #[test]
    fn listing_id_from_key_rejects_short_input() {
        assert!(listing_id_from_key(&[0u8; 7]).is_err());
    }

    #[test]
    fn purchases_key_extracts_account_and_listing_id() {
        let account: [u8; 32] = core::array::from_fn(|i| (i as u8).wrapping_mul(7));
        for id in [0u64, 1, 999, u64::MAX / 2] {
            let key = fake_purchases_key(account, id);
            let (got_acc, got_id) = purchases_key(&key).unwrap();
            assert_eq!(got_acc.0, account);
            assert_eq!(got_id, id);
        }
    }

    #[test]
    fn purchases_key_rejects_short_input() {
        assert!(purchases_key(&[0u8; 16]).is_err());
    }

    #[test]
    fn account_from_bytes_requires_exact_length() {
        assert!(account_from_bytes(&[0u8; 31]).is_none());
        assert!(account_from_bytes(&[0u8; 33]).is_none());
        assert_eq!(account_from_bytes(&[0u8; 32]).unwrap().0, [0u8; 32]);
    }
}
