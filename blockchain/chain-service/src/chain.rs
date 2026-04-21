use anyhow::{anyhow, Context, Result};
use futures::Stream;
use subxt::{
    backend::legacy::LegacyRpcMethods,
    dynamic::{At, Value},
    ext::scale_value::{Composite, Primitive, ValueDef},
    OnlineClient, PolkadotConfig,
};
use subxt_signer::sr25519::Keypair as Sr25519Keypair;

use crate::handler::TargetKind;

pub type AccountId32 = subxt::utils::AccountId32;

const PALLET: &str = "ContentRegistry";

/// Wrapper around a connected subxt client. Cheap to clone — the inner
/// `OnlineClient` is `Clone` and reference-counted.
#[derive(Clone)]
pub struct Chain {
    api: OnlineClient<PolkadotConfig>,
}

impl Chain {
    pub async fn connect(rpc_url: &str) -> Result<Self> {
        let api = OnlineClient::<PolkadotConfig>::from_url(rpc_url)
            .await
            .with_context(|| format!("connecting to {rpc_url}"))?;
        Ok(Self { api })
    }

    pub fn inner(&self) -> &OnlineClient<PolkadotConfig> {
        &self.api
    }

    /// Fetch `Listings[listing_id].locked_content_lock_key`. Returns `None`
    /// if the listing does not exist.
    pub async fn listing_locked_key(&self, listing_id: u64) -> Result<Option<[u8; 80]>> {
        let q = subxt::dynamic::storage(PALLET, "Listings", vec![Value::u128(listing_id.into())]);
        let Some(value) = self
            .api
            .storage()
            .at_latest()
            .await?
            .fetch(&q)
            .await?
        else {
            return Ok(None);
        };
        let decoded = value.to_value()?;
        let field = decoded
            .at("locked_content_lock_key")
            .ok_or_else(|| anyhow!("Listings[{listing_id}] missing locked_content_lock_key field"))?;
        let bytes = value_to_bytes(field)
            .ok_or_else(|| anyhow!("Listings[{listing_id}].locked_content_lock_key not a byte array"))?;
        if bytes.len() != 80 {
            return Err(anyhow!(
                "Listings[{listing_id}].locked_content_lock_key length {} (expected 80)",
                bytes.len()
            ));
        }
        let mut out = [0u8; 80];
        out.copy_from_slice(&bytes);
        Ok(Some(out))
    }

    /// Fetch `EncryptionKeys[target]`. Returns `None` if the target has not
    /// registered an encryption key yet.
    pub async fn encryption_key(&self, target: &AccountId32) -> Result<Option<[u8; 32]>> {
        let q = subxt::dynamic::storage(
            PALLET,
            "EncryptionKeys",
            vec![Value::from_bytes(target.0)],
        );
        let Some(value) = self
            .api
            .storage()
            .at_latest()
            .await?
            .fetch(&q)
            .await?
        else {
            return Ok(None);
        };
        let bytes = value_to_bytes(&value.to_value()?)
            .ok_or_else(|| anyhow!("EncryptionKeys[{target}] not a byte array"))?;
        if bytes.len() != 32 {
            return Err(anyhow!(
                "EncryptionKeys[{target}] length {} (expected 32)",
                bytes.len()
            ));
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(&bytes);
        Ok(Some(out))
    }

    /// Fetch `WrappedKeys[(target, listing_id)]`. Returns `None` if the entry
    /// does not exist — used for idempotency.
    pub async fn wrapped_key(
        &self,
        target: &AccountId32,
        listing_id: u64,
    ) -> Result<Option<[u8; 80]>> {
        let q = subxt::dynamic::storage(
            PALLET,
            "WrappedKeys",
            vec![
                Value::from_bytes(target.0),
                Value::u128(listing_id.into()),
            ],
        );
        let Some(value) = self
            .api
            .storage()
            .at_latest()
            .await?
            .fetch(&q)
            .await?
        else {
            return Ok(None);
        };
        let bytes = value_to_bytes(&value.to_value()?)
            .ok_or_else(|| anyhow!("WrappedKeys[{target},{listing_id}] not a byte array"))?;
        if bytes.len() != 80 {
            return Err(anyhow!(
                "WrappedKeys[{target},{listing_id}] length {} (expected 80)",
                bytes.len()
            ));
        }
        let mut out = [0u8; 80];
        out.copy_from_slice(&bytes);
        Ok(Some(out))
    }

    /// Submit `ContentRegistry::grant_access(listing_id, target, wrapped_key)`
    /// signed by `signer` and wait for inclusion in a finalized block.
    pub async fn submit_grant_access(
        &self,
        signer: &Sr25519Keypair,
        listing_id: u64,
        target: &AccountId32,
        wrapped_key: &[u8; 80],
    ) -> Result<subxt::utils::H256> {
        let tx = subxt::dynamic::tx(
            PALLET,
            "grant_access",
            vec![
                ("listing_id", Value::u128(listing_id.into())),
                ("buyer", Value::from_bytes(target.0)),
                ("wrapped_key", Value::from_bytes(wrapped_key.as_slice())),
            ],
        );
        let progress = self
            .api
            .tx()
            .sign_and_submit_then_watch_default(&tx, signer)
            .await
            .context("submitting grant_access")?;
        let finalized = progress
            .wait_for_finalized_success()
            .await
            .context("grant_access did not finalize")?;
        Ok(finalized.extrinsic_hash())
    }
}

pub(crate) fn value_to_bytes<T>(value: &Value<T>) -> Option<Vec<u8>> {
    // A SCALE-encoded `[u8; N]` decodes as a composite of N `u8` primitives.
    // Walk the composite and collect u128-to-u8.
    match &value.value {
        ValueDef::Composite(Composite::Unnamed(items)) => items
            .iter()
            .map(|v| match &v.value {
                ValueDef::Primitive(Primitive::U128(n)) if *n <= u8::MAX as u128 => Some(*n as u8),
                _ => None,
            })
            .collect::<Option<Vec<u8>>>(),
        ValueDef::Primitive(Primitive::U256(bytes)) => Some(bytes.to_vec()),
        _ => None,
    }
}

/// Build a sr25519 signer from a SURI (e.g. `//Dave`, `mnemonic`, or
/// `0x<hex seed>`). Wraps subxt-signer's `SecretUri::from_str`.
pub fn signer_from_suri(suri: &str) -> Result<Sr25519Keypair> {
    use std::str::FromStr;
    let uri = subxt_signer::SecretUri::from_str(suri)
        .map_err(|e| anyhow!("invalid SURI `{suri}`: {e}"))?;
    Sr25519Keypair::from_uri(&uri)
        .map_err(|e| anyhow!("building sr25519 keypair from `{suri}`: {e}"))
}

// Silences the unused-warning on LegacyRpcMethods if future reconciliation work
// needs it directly; remove if it stays unused.
#[allow(dead_code)]
fn _legacy_rpc_placeholder<C>(_: LegacyRpcMethods<C>) {}

/// Event the daemon acts on. `target` is the account whose x25519 pubkey the
/// content-lock-key should be re-sealed to.
#[derive(Debug, Clone)]
pub struct GrantTrigger {
    pub listing_id: u64,
    pub target: AccountId32,
    pub kind: TargetKind,
}

/// Subscribe to finalized blocks and yield one `GrantTrigger` per matching
/// event. Errors inside the stream short-circuit it — the main loop should
/// restart from connect on a stream error (see Task 8).
pub fn stream_events(chain: Chain) -> impl Stream<Item = Result<GrantTrigger>> + Send + 'static {
    async_stream::try_stream! {
        let mut blocks = chain.inner().blocks().subscribe_finalized().await?;
        while let Some(block) = blocks.next().await {
            let block = block?;
            let events = block.events().await?;
            for evt in events.iter() {
                let evt = evt?;
                if evt.pallet_name() != PALLET { continue; }
                match evt.variant_name() {
                    "PurchaseCompleted" => {
                        let trigger = decode_purchase_completed(&evt)?;
                        yield trigger;
                    }
                    "ListingCreated" => {
                        let trigger = decode_listing_created(&evt)?;
                        yield trigger;
                    }
                    _ => {}
                }
            }
        }
    }
}

fn decode_purchase_completed(
    evt: &subxt::events::EventDetails<PolkadotConfig>,
) -> Result<GrantTrigger> {
    let fields = evt
        .field_values()
        .context("decoding PurchaseCompleted fields")?;
    let listing_id = fields
        .at("listing_id")
        .and_then(|v| v.as_u128())
        .ok_or_else(|| anyhow!("PurchaseCompleted: missing listing_id"))? as u64;
    let buyer_bytes = fields
        .at("buyer")
        .and_then(value_to_bytes)
        .ok_or_else(|| anyhow!("PurchaseCompleted: missing buyer"))?;
    let target = account_from_bytes(&buyer_bytes)
        .ok_or_else(|| anyhow!("PurchaseCompleted: buyer bytes length {}", buyer_bytes.len()))?;
    Ok(GrantTrigger { listing_id, target, kind: TargetKind::Buyer })
}

fn decode_listing_created(
    evt: &subxt::events::EventDetails<PolkadotConfig>,
) -> Result<GrantTrigger> {
    let fields = evt
        .field_values()
        .context("decoding ListingCreated fields")?;
    let listing_id = fields
        .at("listing_id")
        .and_then(|v| v.as_u128())
        .ok_or_else(|| anyhow!("ListingCreated: missing listing_id"))? as u64;
    let creator_bytes = fields
        .at("creator")
        .and_then(value_to_bytes)
        .ok_or_else(|| anyhow!("ListingCreated: missing creator"))?;
    let target = account_from_bytes(&creator_bytes)
        .ok_or_else(|| anyhow!("ListingCreated: creator bytes length {}", creator_bytes.len()))?;
    Ok(GrantTrigger { listing_id, target, kind: TargetKind::Creator })
}

fn account_from_bytes(bytes: &[u8]) -> Option<AccountId32> {
    if bytes.len() != 32 { return None; }
    let mut a = [0u8; 32];
    a.copy_from_slice(bytes);
    Some(subxt::utils::AccountId32(a))
}
