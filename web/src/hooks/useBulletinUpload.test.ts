import { describe, test, expect, vi, afterEach } from 'vitest';
import { MockBulletinClient } from '@parity/bulletin-sdk';

// These imports will fail until the module exists — that's expected (RED phase).
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

// ── uploadToBulletin ──────────────────────────────────────────────────────────

describe('uploadToBulletin', () => {
  test('returns BulletinCidFields with codec and digestBytes from the result CID', async () => {
    const mock = new MockBulletinClient();
    const bytes = new Uint8Array(64).fill(0xff);

    const cid = await uploadToBulletin(bytes, undefined, mock);

    expect(typeof cid.codec).toBe('number');
    expect(cid.digestBytes).toBeInstanceOf(Uint8Array);
    expect(cid.digestBytes.length).toBeGreaterThan(0);
  });

  test('calls onProgress at least once with a value between 0 and 100', async () => {
    const mock = new MockBulletinClient();
    const progresses: number[] = [];
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, (pct) => progresses.push(pct), mock);

    expect(progresses.length).toBeGreaterThan(0);
    for (const p of progresses) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  test('calls authorizePreimage before storing', async () => {
    const mock = new MockBulletinClient();
    const bytes = new Uint8Array(64).fill(0xaa);

    await uploadToBulletin(bytes, undefined, mock);

    const ops = mock.getOperations();
    expect(ops.some((op) => op.type === 'authorize_preimage')).toBe(true);
  });

  test('throws when storage fails', async () => {
    const mock = new MockBulletinClient({ simulateStorageFailure: true });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(uploadToBulletin(bytes, undefined, mock)).rejects.toThrow();
  });
});
