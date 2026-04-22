use std::collections::HashSet;

use anyhow::{anyhow, Context, Result};
use crypto_box::SecretKey;
use subxt::dynamic::{At, Value};
use subxt_signer::sr25519::Keypair;
use tracing::{info, warn};

use crate::chain::{AccountId32, Chain};
use crate::handler::{wrap_and_grant, TargetKind};

const PALLET: &str = "ContentRegistry";

/// One unit of backfill work: re-seal a listing's content key to a specific
/// target account. `Creator` and `Buyer` run the same wrap-and-grant code
/// path; the distinction only drives log labeling.
#[derive(Debug, Clone)]
pub enum BackfillJob {
    Creator { listing_id: u64, creator: AccountId32 },
    Buyer { listing_id: u64, buyer: AccountId32 },
}

impl BackfillJob {
    pub fn target(&self) -> (&AccountId32, u64, TargetKind) {
        match self {
            Self::Creator { listing_id, creator } => (creator, *listing_id, TargetKind::Creator),
            Self::Buyer { listing_id, buyer } => (buyer, *listing_id, TargetKind::Buyer),
        }
    }
}

/// Returns `(creators, buyers)` in `jobs`.
pub fn summarize(jobs: &[BackfillJob]) -> (usize, usize) {
    jobs.iter().fold((0, 0), |(c, b), j| match j {
        BackfillJob::Creator { .. } => (c + 1, b),
        BackfillJob::Buyer { .. } => (c, b + 1),
    })
}

/// Drop candidates whose `WrappedKeys[(target, listing_id)]` entry is already
/// present. Preserves the input order of the surviving jobs.
pub fn filter_pending(
    candidates: Vec<BackfillJob>,
    already_wrapped: &HashSet<([u8; 32], u64)>,
) -> Vec<BackfillJob> {
    candidates
        .into_iter()
        .filter(|job| {
            let (target, listing_id, _) = job.target();
            !already_wrapped.contains(&(target.0, listing_id))
        })
        .collect()
}

/// Iterate every `Listings` entry and every `Purchases` entry on the latest
/// finalized head, build the list of `(target, listing_id)` pairs that still
/// need a `WrappedKeys` entry, log the plan, then execute them sequentially.
/// Called once at startup before the live stream.
pub async fn backfill(chain: &Chain, signer: &Keypair, svc_priv: &SecretKey) -> Result<()> {
    info!("starting backfill scan");
    let head = chain.inner().storage().at_latest().await?;

    let mut candidates: Vec<BackfillJob> = Vec::new();

    // --- Listings (creator targets) ---
    let listings_query = subxt::dynamic::storage(PALLET, "Listings", Vec::<Value>::new());
    let mut stream = head
        .iter(listings_query)
        .await
        .context("starting Listings iteration")?;
    while let Some(kv) = stream.next().await {
        let kv = kv.context("iterating Listings")?;
        let listing_id =
            listing_id_from_key(&kv.key_bytes).context("decoding Listings key suffix")?;
        let value = kv.value.to_value().context("decoding Listing value")?;
        let Some(creator_val) = value.at("creator") else {
            warn!(listing_id, "Listings entry missing `creator` field — skipping");
            continue;
        };
        let Some(creator_bytes) = crate::chain::value_to_bytes(creator_val) else {
            warn!(
                listing_id,
                "Listings[{listing_id}].creator is not a byte array — skipping"
            );
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
        candidates.push(BackfillJob::Creator { listing_id, creator });
    }

    // --- Purchases (buyer targets) ---
    let purchases_query = subxt::dynamic::storage(PALLET, "Purchases", Vec::<Value>::new());
    let mut stream = head
        .iter(purchases_query)
        .await
        .context("starting Purchases iteration")?;
    while let Some(kv) = stream.next().await {
        let kv = kv.context("iterating Purchases")?;
        let (buyer, listing_id) =
            purchases_key(&kv.key_bytes).context("decoding Purchases key suffix")?;
        candidates.push(BackfillJob::Buyer { listing_id, buyer });
    }

    // Build the already-wrapped set with one `WrappedKeys` read per candidate,
    // so the planned total reflects actual work. wrap_and_grant still
    // re-checks idempotently at execution time.
    let mut already_wrapped: HashSet<([u8; 32], u64)> = HashSet::new();
    for job in &candidates {
        let (target, listing_id, _) = job.target();
        if chain.wrapped_key(target, listing_id).await?.is_some() {
            already_wrapped.insert((target.0, listing_id));
        }
    }

    let scanned = candidates.len();
    let jobs = filter_pending(candidates, &already_wrapped);
    let (creators, buyers) = summarize(&jobs);
    let total = jobs.len();
    info!(scanned, total, creators, buyers, "backfill plan");

    for (i, job) in jobs.iter().enumerate() {
        let (target, listing_id, kind) = job.target();
        info!(step = i + 1, total, listing_id, %target, ?kind, "backfill step");
        if let Err(e) =
            wrap_and_grant(chain, signer, svc_priv, listing_id, target, kind).await
        {
            warn!(
                listing_id,
                %target,
                ?kind,
                error = ?e,
                "backfill step failed — will be retried next startup"
            );
        }
    }

    info!(total, "backfill scan complete");
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
    use std::collections::HashSet;

    fn acc(tag: u8) -> AccountId32 {
        subxt::utils::AccountId32([tag; 32])
    }

    #[test]
    fn backfill_job_target_creator() {
        let job = BackfillJob::Creator { listing_id: 7, creator: acc(1) };
        let (target, id, kind) = job.target();
        assert_eq!(*target, acc(1));
        assert_eq!(id, 7);
        assert_eq!(kind, TargetKind::Creator);
    }

    #[test]
    fn backfill_job_target_buyer() {
        let job = BackfillJob::Buyer { listing_id: 9, buyer: acc(2) };
        let (target, id, kind) = job.target();
        assert_eq!(*target, acc(2));
        assert_eq!(id, 9);
        assert_eq!(kind, TargetKind::Buyer);
    }

    #[test]
    fn summarize_counts_creators_and_buyers() {
        let jobs = vec![
            BackfillJob::Creator { listing_id: 1, creator: acc(1) },
            BackfillJob::Buyer { listing_id: 1, buyer: acc(2) },
            BackfillJob::Buyer { listing_id: 2, buyer: acc(3) },
        ];
        assert_eq!(summarize(&jobs), (1, 2));
    }

    #[test]
    fn summarize_empty_is_zero_zero() {
        assert_eq!(summarize(&[]), (0, 0));
    }

    #[test]
    fn filter_pending_drops_already_wrapped_and_preserves_order() {
        let candidates = vec![
            BackfillJob::Creator { listing_id: 1, creator: acc(1) },
            BackfillJob::Buyer { listing_id: 1, buyer: acc(2) },
            BackfillJob::Creator { listing_id: 2, creator: acc(1) },
            BackfillJob::Buyer { listing_id: 2, buyer: acc(3) },
        ];
        let mut wrapped = HashSet::new();
        wrapped.insert((acc(1).0, 1u64)); // creator of listing 1 already done
        wrapped.insert((acc(3).0, 2u64)); // buyer 3 of listing 2 already done

        let pending = filter_pending(candidates, &wrapped);

        // Order preserved, only the two un-wrapped entries remain.
        assert_eq!(pending.len(), 2);
        match &pending[0] {
            BackfillJob::Buyer { listing_id: 1, buyer } => assert_eq!(*buyer, acc(2)),
            other => panic!("expected Buyer(1, acc(2)), got {other:?}"),
        }
        match &pending[1] {
            BackfillJob::Creator { listing_id: 2, creator } => assert_eq!(*creator, acc(1)),
            other => panic!("expected Creator(2, acc(1)), got {other:?}"),
        }
    }

    #[test]
    fn filter_pending_empty_wrapped_set_returns_all() {
        let candidates = vec![
            BackfillJob::Creator { listing_id: 1, creator: acc(1) },
            BackfillJob::Buyer { listing_id: 1, buyer: acc(2) },
        ];
        let pending = filter_pending(candidates.clone(), &HashSet::new());
        assert_eq!(pending.len(), 2);
    }

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
