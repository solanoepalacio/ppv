import { describe, test, expect } from 'vitest';
import { mapListing } from './useContentRegistry';

// Minimal mock of a raw pallet Listing value
function rawListing(overrides: Record<string, unknown> = {}) {
  return {
    creator: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    price: 10_000_000_000n,
    content_cid: { codec: 0x55, digest: { asBytes: () => new Uint8Array(32).fill(0xaa) } },
    thumbnail_cid: { codec: 0x55, digest: { asBytes: () => new Uint8Array(32).fill(0xbb) } },
    content_hash: { asBytes: () => new Uint8Array(32).fill(0xcc) },
    title: { asText: () => 'Test video' },
    description: { asText: () => 'A description' },
    created_at: 42,
    ...overrides,
  };
}

describe('mapListing', () => {
  test('maps raw pallet data to Listing shape', () => {
    const listing = mapListing(0n, rawListing());
    expect(listing.id).toBe(0n);
    expect(listing.creator).toBe('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
    expect(listing.price).toBe(10_000_000_000n);
    expect(listing.title).toBe('Test video');
    expect(listing.description).toBe('A description');
    expect(listing.createdAt).toBe(42);
  });

  test('extracts contentCid codec and digestBytes', () => {
    const listing = mapListing(1n, rawListing());
    expect(listing.contentCid.codec).toBe(0x55);
    expect(listing.contentCid.digestBytes).toEqual(new Uint8Array(32).fill(0xaa));
  });

  test('extracts thumbnailCid and builds gateway URL', () => {
    const listing = mapListing(1n, rawListing());
    expect(listing.thumbnailCid.codec).toBe(0x55);
    expect(listing.thumbnailCid.digestBytes).toEqual(new Uint8Array(32).fill(0xbb));
    expect(listing.thumbnailUrl).toContain('paseo-ipfs.polkadot.io/ipfs/');
  });

  test('extracts content hash bytes', () => {
    const listing = mapListing(1n, rawListing());
    expect(listing.contentHash).toEqual(new Uint8Array(32).fill(0xcc));
  });
});
