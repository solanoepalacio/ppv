import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  fetchListingsByCreator,
  mapListing,
  submitPurchaseMaybeBatched,
} from './useContentRegistry';

vi.mock('./useParachainProvider', () => ({
  getParachainApi: vi.fn(),
}));
vi.mock('./signerManager', () => ({
  getUserSigner: vi.fn(() => ({} as unknown)),
}));

import { getParachainApi } from './useParachainProvider';
const mockGetApi = getParachainApi as unknown as ReturnType<typeof vi.fn>;

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

// ── submitPurchaseMaybeBatched phase tracking ─────────────────────────────────

type Observer = {
  next: (ev: unknown) => void;
  error: (err: unknown) => void;
};

function makeFakeTx() {
  const observers: Observer[] = [];
  const unsubscribe = vi.fn();
  const tx = {
    decodedCall: { __fake: true },
    signSubmitAndWatch: vi.fn(() => ({
      subscribe: (o: Observer) => {
        observers.push(o);
        return { unsubscribe };
      },
    })),
  };
  return { tx, observers, unsubscribe };
}

function makeApi(opts: {
  encryptionKey?: { asBytes: () => Uint8Array } | undefined;
  purchaseTx: ReturnType<typeof makeFakeTx>['tx'];
  batchTx?: ReturnType<typeof makeFakeTx>['tx'];
}) {
  return {
    query: {
      ContentRegistry: {
        EncryptionKeys: {
          getValue: vi.fn().mockResolvedValue(opts.encryptionKey),
        },
      },
    },
    tx: {
      ContentRegistry: {
        purchase: vi.fn(() => opts.purchaseTx),
        register_encryption_key: vi.fn(() => ({ decodedCall: { __reg: true } })),
      },
      Utility: {
        batch_all: vi.fn(() => opts.batchTx ?? opts.purchaseTx),
      },
    },
  };
}

describe('submitPurchaseMaybeBatched — phase tracking', () => {
  beforeEach(() => vi.clearAllMocks());

  test('fires onPhase("signed") then onPhase("finalized") on the single-tx branch', async () => {
    const { tx, observers } = makeFakeTx();
    mockGetApi.mockReturnValue(makeApi({
      encryptionKey: { asBytes: () => new Uint8Array(32).fill(1) },
      purchaseTx: tx,
    }));

    const phases: string[] = [];
    const pending = submitPurchaseMaybeBatched(5n, 'addr', new Uint8Array(32), {
      onPhase: (p) => phases.push(p),
    });

    // Wait for the async encryption-key check to complete and subscription to attach.
    await vi.waitFor(() => expect(observers.length).toBe(1));

    observers[0].next({ type: 'signed', txHash: '0x01' });
    observers[0].next({ type: 'broadcasted', txHash: '0x01' });
    observers[0].next({ type: 'txBestBlocksState', txHash: '0x01', found: false, isValid: true });
    observers[0].next({ type: 'finalized', txHash: '0x01', ok: true, events: [], block: {} });

    await pending;
    expect(phases).toEqual(['signed', 'finalized']);
  });

  test('takes the batch branch when the encryption key is missing', async () => {
    const { tx, observers } = makeFakeTx();
    const api = makeApi({
      encryptionKey: undefined,
      purchaseTx: tx,
      batchTx: tx,
    });
    mockGetApi.mockReturnValue(api);

    const phases: string[] = [];
    const pending = submitPurchaseMaybeBatched(7n, 'addr', new Uint8Array(32), {
      onPhase: (p) => phases.push(p),
    });

    await vi.waitFor(() => expect(observers.length).toBe(1));
    observers[0].next({ type: 'signed', txHash: '0x02' });
    observers[0].next({ type: 'finalized', txHash: '0x02', ok: true, events: [], block: {} });

    await pending;
    expect(api.tx.Utility.batch_all).toHaveBeenCalledOnce();
    expect(phases).toEqual(['signed', 'finalized']);
  });

  test('rejects when the finalized event reports ok=false', async () => {
    const { tx, observers } = makeFakeTx();
    mockGetApi.mockReturnValue(makeApi({
      encryptionKey: { asBytes: () => new Uint8Array(32).fill(1) },
      purchaseTx: tx,
    }));

    const pending = submitPurchaseMaybeBatched(9n, 'addr', new Uint8Array(32));
    await vi.waitFor(() => expect(observers.length).toBe(1));

    observers[0].next({ type: 'signed', txHash: '0x03' });
    observers[0].next({ type: 'finalized', txHash: '0x03', ok: false, events: [], block: {} });

    await expect(pending).rejects.toThrow(/purchase failed/);
  });

});

// ── fetchListingsByCreator ────────────────────────────────────────────────────

describe('fetchListingsByCreator', () => {
  beforeEach(() => vi.clearAllMocks());

  test('returns empty array when the creator has no listings', async () => {
    const byCreator = { getEntries: vi.fn().mockResolvedValue([]) };
    const listings = { getValue: vi.fn() };
    const purchaseCount = { getValue: vi.fn() };
    mockGetApi.mockReturnValue({
      query: {
        ContentRegistry: {
          ListingsByCreator: byCreator,
          Listings: listings,
          PurchaseCount: purchaseCount,
        },
      },
    });

    const result = await fetchListingsByCreator('addr');
    expect(byCreator.getEntries).toHaveBeenCalledWith('addr');
    expect(listings.getValue).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('resolves each id to a listing + purchase count via parallel point lookups', async () => {
    const entries = [
      { keyArgs: ['addr', 5n] },
      { keyArgs: ['addr', 9n] },
    ];
    const listings = {
      getValue: vi.fn(async (id: bigint) =>
        rawListing({ price: id === 5n ? 100n : 200n, title: { asText: () => `t${id}` } }),
      ),
    };
    const purchaseCount = {
      getValue: vi.fn(async (id: bigint) => (id === 5n ? 3 : 0)),
    };
    mockGetApi.mockReturnValue({
      query: {
        ContentRegistry: {
          ListingsByCreator: { getEntries: vi.fn().mockResolvedValue(entries) },
          Listings: listings,
          PurchaseCount: purchaseCount,
        },
      },
    });

    const result = await fetchListingsByCreator('addr');
    expect(result).toHaveLength(2);
    const byId = new Map(result.map((r) => [r.id, r]));
    expect(byId.get(5n)?.purchaseCount).toBe(3);
    expect(byId.get(5n)?.price).toBe(100n);
    expect(byId.get(5n)?.title).toBe('t5');
    expect(byId.get(9n)?.purchaseCount).toBe(0);
    expect(byId.get(9n)?.price).toBe(200n);
  });

  test('treats missing listing values as filtered out (defensive)', async () => {
    const entries = [
      { keyArgs: ['addr', 5n] },
      { keyArgs: ['addr', 9n] },
    ];
    const listings = {
      getValue: vi.fn(async (id: bigint) => (id === 5n ? rawListing() : undefined)),
    };
    const purchaseCount = { getValue: vi.fn(async () => 0) };
    mockGetApi.mockReturnValue({
      query: {
        ContentRegistry: {
          ListingsByCreator: { getEntries: vi.fn().mockResolvedValue(entries) },
          Listings: listings,
          PurchaseCount: purchaseCount,
        },
      },
    });

    const result = await fetchListingsByCreator('addr');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5n);
  });
});

describe('submitPurchaseMaybeBatched — error handling tail', () => {
  test('rejects when the observable errors', async () => {
    const { tx, observers } = makeFakeTx();
    mockGetApi.mockReturnValue(makeApi({
      encryptionKey: { asBytes: () => new Uint8Array(32).fill(1) },
      purchaseTx: tx,
    }));

    const pending = submitPurchaseMaybeBatched(11n, 'addr', new Uint8Array(32));
    await vi.waitFor(() => expect(observers.length).toBe(1));

    observers[0].error(new Error('wallet rejected'));

    await expect(pending).rejects.toThrow(/wallet rejected/);
  });
});
