import { Binary } from 'polkadot-api';
import { getParachainApi, getUserSigner } from './useParachainProvider';
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
  const api = getParachainApi();
  const entries = await api.query.ContentRegistry.Listings.getEntries();
  return entries
    .map(({ keyArgs: [id], value: l }) => mapListing(id, l))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function fetchListing(id: bigint): Promise<Listing | undefined> {
  const api = getParachainApi();
  const l = await api.query.ContentRegistry.Listings.getValue(id);
  if (!l) return undefined;
  return mapListing(id, l);
}

export async function fetchPurchases(
  address: string,
): Promise<Array<{ listingId: bigint; blockNumber: number }>> {
  const api = getParachainApi();
  const entries = await api.query.ContentRegistry.Purchases.getEntries(address);
  return entries
    .map(({ keyArgs: [, listingId], value: blockNumber }) => ({
      listingId: listingId as bigint,
      blockNumber: blockNumber as number,
    }))
    .sort((a, b) => b.blockNumber - a.blockNumber);
}

export async function hasPurchased(address: string, listingId: bigint): Promise<boolean> {
  const api = getParachainApi();
  const result = await api.query.ContentRegistry.Purchases.getValue(address, listingId);
  return result !== undefined;
}

// ── Writes ────────────────────────────────────────────────────────────────────

export interface CreateListingParams {
  contentCid: BulletinCidFields;
  thumbnailCid: BulletinCidFields;
  contentHash: Uint8Array;
  title: string;
  description: string;
  price: bigint;
}

export async function submitCreateListing(params: CreateListingParams): Promise<bigint> {
  const api = getParachainApi();
  const signer = getUserSigner();

  const tx = api.tx.ContentRegistry.create_listing({
    content_cid: {
      codec: params.contentCid.codec,
      digest: Binary.fromBytes(params.contentCid.digestBytes),
    },
    thumbnail_cid: {
      codec: params.thumbnailCid.codec,
      digest: Binary.fromBytes(params.thumbnailCid.digestBytes),
    },
    content_hash: Binary.fromBytes(params.contentHash),
    title: Binary.fromText(params.title),
    description: Binary.fromText(params.description),
    price: params.price,
    locked_content_lock_key: Binary.fromBytes(new Uint8Array()),
  });

  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`create_listing failed: ${JSON.stringify(result)}`);

  const nextId = await api.query.ContentRegistry.NextListingId.getValue();
  return nextId - 1n;
}

export async function submitPurchase(listingId: bigint): Promise<void> {
  const api = getParachainApi();
  const signer = getUserSigner();

  const tx = api.tx.ContentRegistry.purchase({ listing_id: listingId });
  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`purchase failed: ${JSON.stringify(result)}`);
}
