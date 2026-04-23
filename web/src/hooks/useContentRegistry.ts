import { Binary, FixedSizeBinary, type PolkadotSigner } from 'polkadot-api';
import { getParachainApi } from './useParachainProvider';
import { getUserSigner } from './signerManager';
import { bulletinCidToGatewayUrl } from '../utils/bulletinCid';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface BulletinCidFields {
  codec: number;
  digestBytes: Uint8Array;
}

export interface Listing {
  id: bigint;
  creator: string;
  price: bigint;
  contentCid: BulletinCidFields;
  thumbnailCid: BulletinCidFields;
  thumbnailUrl: string;
  contentHash: Uint8Array;
  title: string;
  description: string;
  createdAt: number;
}

// ── Internal mapper (exported for testing) ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapListing(id: bigint, l: any): Listing {
  const thumbnailCid: BulletinCidFields = {
    codec: l.thumbnail_cid.codec,
    digestBytes: l.thumbnail_cid.digest.asBytes(),
  };
  return {
    id,
    creator: l.creator,
    price: l.price,
    contentCid: { codec: l.content_cid.codec, digestBytes: l.content_cid.digest.asBytes() },
    thumbnailCid,
    thumbnailUrl: bulletinCidToGatewayUrl(thumbnailCid.codec, thumbnailCid.digestBytes),
    contentHash: l.content_hash.asBytes(),
    title: l.title.asText(),
    description: l.description.asText(),
    createdAt: l.created_at,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function fetchAllListings(): Promise<Listing[]> {
  const api = await getParachainApi();
  const entries = await api.query.ContentRegistry.Listings.getEntries();
  return entries
    .map(({ keyArgs: [id], value: l }) => mapListing(id, l))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export interface ListingWithStats extends Listing {
  purchaseCount: number;
}

/**
 * Fetch every listing whose creator is `account`, each joined with its
 * on-chain `PurchaseCount`. Uses the `ListingsByCreator` reverse index to
 * avoid a full `Listings` scan.
 *
 * Missing `PurchaseCount` entries are treated as `0` (pallet storage uses
 * `ValueQuery` with `u32` default). Listings whose value happens to be
 * absent are filtered out — shouldn't happen, but defensive.
 */
export async function fetchListingsByCreator(account: string): Promise<ListingWithStats[]> {
  const api = await getParachainApi();
  // New storage items aren't in the type-generated descriptors yet; cast until
  // `npm run update-types` regenerates them against the rebuilt runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = (api.query as any).ContentRegistry;
  const entries: Array<{ keyArgs: [string, bigint] }> = await reg.ListingsByCreator.getEntries(
    account,
  );
  const ids = entries.map((e) => e.keyArgs[1] as bigint);

  const pairs = await Promise.all(
    ids.map(async (id) => {
      const [raw, count] = await Promise.all([
        reg.Listings.getValue(id),
        reg.PurchaseCount.getValue(id),
      ]);
      if (!raw) return undefined;
      const listing = mapListing(id, raw);
      const purchaseCount = typeof count === 'number' ? count : Number(count ?? 0);
      return { ...listing, purchaseCount };
    }),
  );

  return pairs
    .filter((x): x is ListingWithStats => x !== undefined)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function fetchListing(id: bigint): Promise<Listing | undefined> {
  const api = await getParachainApi();
  const l = await api.query.ContentRegistry.Listings.getValue(id);
  if (!l) return undefined;
  return mapListing(id, l);
}

export async function fetchPurchases(
  address: string,
): Promise<Array<{ listingId: bigint; blockNumber: number }>> {
  const api = await getParachainApi();
  const entries = await api.query.ContentRegistry.Purchases.getEntries(address);
  return entries
    .map(({ keyArgs: [, listingId], value: blockNumber }) => ({
      listingId: listingId as bigint,
      blockNumber: blockNumber as number,
    }))
    .sort((a, b) => b.blockNumber - a.blockNumber);
}

export async function hasPurchased(address: string, listingId: bigint): Promise<boolean> {
  const api = await getParachainApi();
  const result = await api.query.ContentRegistry.Purchases.getValue(address, listingId);
  return result !== undefined;
}

/** Read the 32-byte SVC_PUB baked into genesis. Panics on misconfigured chains. */
export async function fetchServicePublicKey(): Promise<Uint8Array> {
  const api = await getParachainApi();
  const pub = await api.query.ContentRegistry.ServicePublicKey.getValue();
  return pub.asBytes();
}

/** Returns the registered x25519 pubkey for `address`, or null if none. */
export async function fetchEncryptionKey(address: string): Promise<Uint8Array | null> {
  const api = await getParachainApi();
  const entry = await api.query.ContentRegistry.EncryptionKeys.getValue(address);
  return entry ? entry.asBytes() : null;
}

/**
 * One-shot read of `WrappedKeys[(address, listingId)]`. Returns the 80-byte
 * sealed payload if already stored, or null if the daemon hasn't written yet.
 */
export async function fetchWrappedKey(
  address: string,
  listingId: bigint,
): Promise<Uint8Array | null> {
  const api = await getParachainApi();
  const v = await api.query.ContentRegistry.WrappedKeys.getValue(address, listingId);
  return v ? v.asBytes() : null;
}

/**
 * Subscribe to `WrappedKeys[(address, listingId)]`. Emits `null` until
 * the daemon writes it, then emits the 80-byte sealed payload.
 */
export function watchWrappedKey(
  address: string,
  listingId: bigint,
  onChange: (sealed: Uint8Array | null) => void,
): { unsubscribe: () => void } {
  // Subscribe once the provider is ready. Returning a sync handle keeps the
  // caller's effect cleanup contract intact.
  let realSub: { unsubscribe: () => void } | null = null;
  let cancelled = false;
  getParachainApi()
    .then((api) => {
      if (cancelled) return;
      realSub = api.query.ContentRegistry.WrappedKeys.watchValue(address, listingId).subscribe({
        next: (v) => onChange(v ? v.asBytes() : null),
        error: (err) => console.error('WrappedKeys subscription error:', err),
      });
    })
    .catch((err) => console.error('WrappedKeys init failed:', err));
  return {
    unsubscribe: () => {
      cancelled = true;
      realSub?.unsubscribe();
    },
  };
}

// ── Writes ────────────────────────────────────────────────────────────────────

export interface CreateListingParams {
  contentCid: BulletinCidFields;
  thumbnailCid: BulletinCidFields;
  contentHash: Uint8Array;
  title: string;
  description: string;
  price: bigint;
  lockedContentLockKey: Uint8Array; // exactly 80 bytes, sealed to SVC_PUB
}

async function createListingCall(params: CreateListingParams) {
  const api = await getParachainApi();
  if (params.lockedContentLockKey.length !== 80) {
    throw new Error(
      `lockedContentLockKey must be 80 bytes, got ${params.lockedContentLockKey.length}`,
    );
  }
  return api.tx.ContentRegistry.create_listing({
    content_cid: {
      codec: params.contentCid.codec,
      digest: FixedSizeBinary.fromBytes(params.contentCid.digestBytes),
    },
    thumbnail_cid: {
      codec: params.thumbnailCid.codec,
      digest: FixedSizeBinary.fromBytes(params.thumbnailCid.digestBytes),
    },
    content_hash: FixedSizeBinary.fromBytes(params.contentHash),
    title: Binary.fromText(params.title),
    description: Binary.fromText(params.description),
    price: params.price,
    locked_content_lock_key: FixedSizeBinary.fromBytes(params.lockedContentLockKey),
  });
}

async function registerEncryptionKeyCall(pubkey: Uint8Array) {
  const api = await getParachainApi();
  if (pubkey.length !== 32) throw new Error(`pubkey must be 32 bytes, got ${pubkey.length}`);
  return api.tx.ContentRegistry.register_encryption_key({
    pubkey: FixedSizeBinary.fromBytes(pubkey),
  });
}

async function purchaseCall(listingId: bigint) {
  const api = await getParachainApi();
  return api.tx.ContentRegistry.purchase({ listing_id: listingId });
}

/** Plain `create_listing`. Caller must have `EncryptionKeys[caller]` already. */
export async function submitCreateListing(params: CreateListingParams): Promise<bigint> {
  const api = await getParachainApi();
  const signer = getUserSigner();
  const tx = await createListingCall(params);
  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`create_listing failed: ${JSON.stringify(result)}`);
  const nextId = await api.query.ContentRegistry.NextListingId.getValue();
  return nextId - 1n;
}

/** Plain `register_encryption_key`. Rarely called directly — see batch helpers. */
export async function submitRegisterEncryptionKey(pubkey: Uint8Array): Promise<void> {
  const signer = getUserSigner();
  const call = await registerEncryptionKeyCall(pubkey);
  const result = await call.signAndSubmit(signer);
  if (!result.ok) throw new Error(`register_encryption_key failed: ${JSON.stringify(result)}`);
}

/** Plain `purchase`. Caller must have `EncryptionKeys[caller]` already. */
export async function submitPurchase(listingId: bigint): Promise<void> {
  const signer = getUserSigner();
  const call = await purchaseCall(listingId);
  const result = await call.signAndSubmit(signer);
  if (!result.ok) throw new Error(`purchase failed: ${JSON.stringify(result)}`);
}

// ── Batched helpers ───────────────────────────────────────────────────────────

async function signBatchAll(
  signer: PolkadotSigner,
  calls: ReturnType<typeof createListingCall>[] | unknown[],
): Promise<void> {
  const api = await getParachainApi();
  // Each call is a typed `Tx`; PAPI exposes its enum shape on `.decodedCall`,
  // which is exactly what `Utility.batch_all` expects.
  const inner = calls.map((c) => (c as { decodedCall: unknown }).decodedCall);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = (api.tx as any).Utility.batch_all({ calls: inner });
  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`batch_all failed: ${JSON.stringify(result)}`);
}

// ── Phase-tracked submission ──────────────────────────────────────────────────

export type SubmitPhase = 'signed' | 'finalized';
export interface SubmitOptions {
  onPhase?: (phase: SubmitPhase) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WatchableTx = { signSubmitAndWatch: (signer: PolkadotSigner) => { subscribe: (o: any) => { unsubscribe: () => void } } };

function signAndWatchFinalized(
  tx: WatchableTx,
  signer: PolkadotSigner,
  label: string,
  onPhase?: (phase: SubmitPhase) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sub = tx.signSubmitAndWatch(signer).subscribe({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      next: (ev: any) => {
        if (ev.type === 'signed') {
          onPhase?.('signed');
        } else if (ev.type === 'finalized') {
          sub.unsubscribe();
          if (!ev.ok) {
            reject(new Error(`${label} failed: ${JSON.stringify(ev)}`));
            return;
          }
          onPhase?.('finalized');
          resolve();
        }
      },
      error: (err: unknown) => {
        sub.unsubscribe();
        reject(err);
      },
    });
  });
}

/**
 * Create a listing. If `EncryptionKeys[caller]` is missing, batches
 * `register_encryption_key(pubkey)` before `create_listing`. Returns
 * the new `listing_id`.
 */
export async function submitCreateListingMaybeBatched(
  params: CreateListingParams,
  callerAddress: string,
  pubkeyIfMissing: Uint8Array,
): Promise<bigint> {
  const api = await getParachainApi();
  const signer = getUserSigner();
  const already = await fetchEncryptionKey(callerAddress);

  if (already) {
    const tx = await createListingCall(params);
    const result = await tx.signAndSubmit(signer);
    if (!result.ok) throw new Error(`create_listing failed: ${JSON.stringify(result)}`);
  } else {
    const calls = await Promise.all([
      registerEncryptionKeyCall(pubkeyIfMissing),
      createListingCall(params),
    ]);
    await signBatchAll(signer, calls);
  }

  const nextId = await api.query.ContentRegistry.NextListingId.getValue();
  return nextId - 1n;
}

/**
 * Purchase a listing. If `EncryptionKeys[caller]` is missing, batches
 * `register_encryption_key(pubkey)` before `purchase`.
 *
 * Resolves after the extrinsic is finalized. `options.onPhase` is invoked
 * when the user signs (`'signed'`) and again on finalization (`'finalized'`),
 * so the UI can show progressive status.
 */
export async function submitPurchaseMaybeBatched(
  listingId: bigint,
  callerAddress: string,
  pubkeyIfMissing: Uint8Array,
  options: SubmitOptions = {},
): Promise<void> {
  const signer = getUserSigner();
  const already = await fetchEncryptionKey(callerAddress);

  if (already) {
    const call = await purchaseCall(listingId);
    await signAndWatchFinalized(
      call as unknown as WatchableTx,
      signer,
      'purchase',
      options.onPhase,
    );
  } else {
    const api = await getParachainApi();
    const calls = await Promise.all([
      registerEncryptionKeyCall(pubkeyIfMissing),
      purchaseCall(listingId),
    ]);
    const inner = calls.map((c) => (c as { decodedCall: unknown }).decodedCall);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx = (api.tx as any).Utility.batch_all({ calls: inner });
    await signAndWatchFinalized(
      tx as WatchableTx,
      signer,
      'batch_all(register+purchase)',
      options.onPhase,
    );
  }
}
