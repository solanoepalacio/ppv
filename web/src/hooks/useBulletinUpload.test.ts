import { describe, test, expect, vi, afterEach } from 'vitest';
import { MockBulletinClient } from '@parity/bulletin-sdk';

vi.mock('./signerManager', () => ({
  getUserSigner: vi.fn(),
  getUserAddress: vi.fn(),
}));

import { fetchFromIpfs, uploadToBulletin } from './useBulletinUpload';
import type { BulletinCidFields } from './useContentRegistry';

// ── fetchFromIpfs (unchanged) ─────────────────────────────────────────────────

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

// ── uploadToBulletin — two-signer flow with on-chain quota check ──────────────

type QuotaFn = (address: string) => Promise<{ transactions: number; bytes: bigint } | null>;

function makeCtx(partial: {
  aliceClient?: MockBulletinClient;
  userClient?: MockBulletinClient;
  userAddress?: string;
  getRemainingAuthorization?: QuotaFn;
}) {
  return {
    aliceClient: partial.aliceClient ?? new MockBulletinClient(),
    userClient: partial.userClient ?? new MockBulletinClient(),
    userAddress: partial.userAddress ?? '5Bob',
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

  test('when user has no authorization, Alice authorizes and user stores', async () => {
    const ctx = makeCtx({ getRemainingAuthorization: async () => null });
    const bytes = new Uint8Array(64).fill(0xaa);

    await uploadToBulletin(bytes, undefined, ctx);

    const aliceOps = ctx.aliceClient.getOperations();
    const userOps = ctx.userClient.getOperations();

    expect(aliceOps.some((op) => op.type === 'authorize_account' && op.who === '5Bob')).toBe(true);
    expect(userOps.some((op) => op.type === 'store')).toBe(true);
    // User must never sign an authorization extrinsic.
    expect(userOps.every((op) => op.type !== 'authorize_account')).toBe(true);
    expect(userOps.every((op) => op.type !== 'authorize_preimage')).toBe(true);
    // Alice must never sign a store extrinsic.
    expect(aliceOps.every((op) => op.type !== 'store')).toBe(true);
  });

  test('when user quota is sufficient, skip authorize_account entirely', async () => {
    const ctx = makeCtx({
      getRemainingAuthorization: async () => ({
        transactions: 5,
        bytes: 50n * 1024n * 1024n,
      }),
    });
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, undefined, ctx);

    const aliceOps = ctx.aliceClient.getOperations();
    expect(aliceOps.length).toBe(0);

    const userOps = ctx.userClient.getOperations();
    expect(userOps.some((op) => op.type === 'store')).toBe(true);
  });

  test('when user quota is too small for this upload, re-authorize', async () => {
    const ctx = makeCtx({
      getRemainingAuthorization: async () => ({
        transactions: 0,
        bytes: 0n,
      }),
    });
    const bytes = new Uint8Array(64).fill(0x02);

    await uploadToBulletin(bytes, undefined, ctx);

    const aliceOps = ctx.aliceClient.getOperations();
    expect(aliceOps.some((op) => op.type === 'authorize_account')).toBe(true);
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

    expect(ctx.aliceClient.getOperations()).toEqual([]);
    expect(ctx.userClient.getOperations()).toEqual([]);
  });

  test('throws when storage fails', async () => {
    const userClient = new MockBulletinClient({ simulateStorageFailure: true });
    const ctx = makeCtx({ userClient });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow();
  });

  test('propagates authorization failure without calling store', async () => {
    const aliceClient = new MockBulletinClient({ simulateAuthFailure: true });
    const ctx = makeCtx({ aliceClient });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow();

    expect(ctx.userClient.getOperations().some((op) => op.type === 'store')).toBe(false);
  });
});

// ── user client address invalidation ─────────────────────────────────────────

describe('user client address invalidation', () => {
  test('rebuilds user client when selected address changes', async () => {
    const { _resetUserClientForTests, getUserClientForTests } = await import('./useBulletinUpload');
    // First address
    const signerA = { publicKey: new Uint8Array([1]) };
    const getUserSigner = (await import('./signerManager')).getUserSigner as ReturnType<typeof vi.fn>;
    const getUserAddress = (await import('./signerManager')).getUserAddress as ReturnType<typeof vi.fn>;
    getUserSigner.mockReturnValue(signerA);
    getUserAddress.mockReturnValue('5AAAA');
    const first = getUserClientForTests();
    const firstAgain = getUserClientForTests();
    expect(first).toBe(firstAgain); // same address → cached

    // Address changes → rebuild
    const signerB = { publicKey: new Uint8Array([2]) };
    getUserSigner.mockReturnValue(signerB);
    getUserAddress.mockReturnValue('5BBBB');
    const second = getUserClientForTests();
    expect(second).not.toBe(first);

    _resetUserClientForTests();
  });
});
