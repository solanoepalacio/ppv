import { describe, test, expect, vi, afterEach } from 'vitest';
import { MockBulletinClient } from '@parity/bulletin-sdk';

import { fetchFromIpfs, uploadToBulletin } from './useBulletinUpload';
import type { BulletinCidFields } from './useContentRegistry';

// ── fetchFromIpfs ─────────────────────────────────────────────────────────────

describe('fetchFromIpfs', () => {
  afterEach(() => vi.restoreAllMocks());

  test('returns Uint8Array on a successful fetch', async () => {
    const data = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(data.buffer),
    }));

    const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xab) };
    const result = await fetchFromIpfs(cid);
    expect(result).toEqual(data);
  });

  test('requests the Paseo IPFS gateway URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    vi.stubGlobal('fetch', fetchMock);

    const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xab) };
    await fetchFromIpfs(cid);

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/paseo-ipfs\.polkadot\.io\/ipfs\//);
  });

  test('throws on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32).fill(0x01) };
    await expect(fetchFromIpfs(cid)).rejects.toThrow('404');
  });
});

// ── uploadToBulletin — single-signer (Alice) flow ─────────────────────────────
//
// Bulletin is content storage, not a user-identity surface. The user wallet
// (Talisman) is intentionally not used against Bulletin — its
// `withSignedTransaction` path rebuilds extrinsics from its own chain
// metadata and yields BadProof against non-mainstream chains like Paseo
// Bulletin. Alice signs every Bulletin extrinsic. The `address` field
// identifies whose authorization quota is checked/refreshed (Alice's).

type QuotaFn = (address: string) => Promise<{ transactions: number; bytes: bigint } | null>;

function makeCtx(partial: {
  client?: MockBulletinClient;
  address?: string;
  getRemainingAuthorization?: QuotaFn;
}) {
  return {
    client: partial.client ?? new MockBulletinClient(),
    address: partial.address ?? '5Alice',
    getRemainingAuthorization: partial.getRemainingAuthorization ?? (async () => null),
  };
}

describe('uploadToBulletin', () => {
  test('returns BulletinCidFields with codec and digestBytes from the store result', async () => {
    const ctx = makeCtx({});
    const bytes = new Uint8Array(64).fill(0xff);

    const cid = await uploadToBulletin(bytes, undefined, ctx);

    expect(typeof cid.codec).toBe('number');
    expect(cid.digestBytes).toBeInstanceOf(Uint8Array);
    expect(cid.digestBytes.length).toBeGreaterThan(0);
  });

  test('Alice signs both authorize_account and store when quota is missing', async () => {
    const ctx = makeCtx({ getRemainingAuthorization: async () => null });
    const bytes = new Uint8Array(64).fill(0xaa);

    await uploadToBulletin(bytes, undefined, ctx);

    const ops = ctx.client.getOperations();
    expect(ops.some((op) => op.type === 'authorize_account' && op.who === '5Alice')).toBe(true);
    expect(ops.some((op) => op.type === 'store')).toBe(true);
  });

  test('when quota is sufficient, skip authorize_account and only call store', async () => {
    const ctx = makeCtx({
      getRemainingAuthorization: async () => ({
        transactions: 5,
        bytes: 50n * 1024n * 1024n,
      }),
    });
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, undefined, ctx);

    const ops = ctx.client.getOperations();
    expect(ops.every((op) => op.type !== 'authorize_account')).toBe(true);
    expect(ops.some((op) => op.type === 'store')).toBe(true);
  });

  test('when quota is too small for this upload, re-authorize first', async () => {
    const ctx = makeCtx({
      getRemainingAuthorization: async () => ({
        transactions: 0,
        bytes: 0n,
      }),
    });
    const bytes = new Uint8Array(64).fill(0x02);

    await uploadToBulletin(bytes, undefined, ctx);

    const ops = ctx.client.getOperations();
    expect(ops.some((op) => op.type === 'authorize_account')).toBe(true);
  });

  test('calls onProgress with values between 0 and 100', async () => {
    const ctx = makeCtx({});
    const progresses: number[] = [];
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, (pct) => progresses.push(pct), ctx);

    expect(progresses.length).toBeGreaterThan(0);
    for (const p of progresses) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  test('calls onProgress with 100 at least once on success', async () => {
    const ctx = makeCtx({});
    const progresses: number[] = [];
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, (pct) => progresses.push(pct), ctx);

    expect(progresses).toContain(100);
  });

  test('rejects files larger than 2 MiB before touching the chain', async () => {
    const ctx = makeCtx({});
    const bytes = new Uint8Array(2 * 1024 * 1024 + 1);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow(/2 MiB/i);

    expect(ctx.client.getOperations()).toEqual([]);
  });

  test('throws when storage fails', async () => {
    const client = new MockBulletinClient({ simulateStorageFailure: true });
    const ctx = makeCtx({ client });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow();
  });

  test('propagates authorization failure without calling store', async () => {
    const client = new MockBulletinClient({ simulateAuthFailure: true });
    const ctx = makeCtx({ client });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow();

    expect(ctx.client.getOperations().some((op) => op.type === 'store')).toBe(false);
  });
});
