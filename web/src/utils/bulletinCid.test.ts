import { describe, test, expect } from 'vitest';
import { bulletinCidToString, bulletinCidToGatewayUrl } from './bulletinCid';

describe('bulletinCidToString', () => {
  test('produces a CIDv1 base32 string for raw codec', () => {
    const codec = 0x55;
    const digestBytes = new Uint8Array(32).fill(0xab);
    const cid = bulletinCidToString(codec, digestBytes);
    // CIDv1 encoded in base32 always starts with 'b' (multibase prefix)
    expect(cid).toMatch(/^b/);
    expect(typeof cid).toBe('string');
    expect(cid.length).toBeGreaterThan(10);
  });

  test('same inputs produce the same CID', () => {
    const codec = 0x55;
    const digestBytes = new Uint8Array(32).fill(0xcc);
    expect(bulletinCidToString(codec, digestBytes)).toBe(bulletinCidToString(codec, digestBytes));
  });

  test('different digests produce different CIDs', () => {
    const a = new Uint8Array(32).fill(0x01);
    const b = new Uint8Array(32).fill(0x02);
    expect(bulletinCidToString(0x55, a)).not.toBe(bulletinCidToString(0x55, b));
  });
});

describe('bulletinCidToGatewayUrl', () => {
  test('wraps the CID string in the Paseo IPFS gateway URL', () => {
    const codec = 0x55;
    const digestBytes = new Uint8Array(32).fill(0xab);
    const url = bulletinCidToGatewayUrl(codec, digestBytes);
    const cid = bulletinCidToString(codec, digestBytes);
    expect(url).toBe(`https://paseo-ipfs.polkadot.io/ipfs/${cid}`);
  });
});
