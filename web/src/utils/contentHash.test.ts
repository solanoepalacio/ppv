// @vitest-environment node
// blakejs' `normalizeInput` checks `input instanceof Uint8Array` against the
// Node realm's Uint8Array. Under jsdom, `TextEncoder().encode(...)` and
// `new Uint8Array(...)` return instances from the jsdom realm, so the check
// fails with "Input must be an string, Buffer or Uint8Array". Pin this test
// file to the node environment to keep the realms aligned.
import { describe, test, expect } from 'vitest';
import { blake2b } from 'blakejs';
import { verifyContentHash } from './contentHash';

describe('verifyContentHash', () => {
  test('returns true when bytes hash matches expected', () => {
    const bytes = new TextEncoder().encode('hello world');
    const expected = blake2b(bytes, undefined, 32);
    expect(verifyContentHash(bytes, expected)).toBe(true);
  });

  test('returns false when hash does not match', () => {
    const bytes = new TextEncoder().encode('hello world');
    const wrong = new Uint8Array(32); // all zeros
    expect(verifyContentHash(bytes, wrong)).toBe(false);
  });

  test('returns false when expected hash has wrong length', () => {
    const bytes = new TextEncoder().encode('data');
    expect(verifyContentHash(bytes, new Uint8Array(0))).toBe(false);
  });
});
