import { beforeEach, describe, expect, it } from 'vitest';
import { clearCachedKey, getCachedKey, setCachedKey } from './contentLockKeyCache';

describe('contentLockKeyCache', () => {
  beforeEach(() => {
    clearCachedKey(1n);
    clearCachedKey(2n);
  });

  it('stores and retrieves by bigint listing id', () => {
    const k = new Uint8Array(32).fill(0xab);
    setCachedKey(1n, k);
    expect(Array.from(getCachedKey(1n)!)).toEqual(Array.from(k));
  });

  it('returns undefined for unknown ids', () => {
    expect(getCachedKey(2n)).toBeUndefined();
  });

  it('clear removes the entry', () => {
    setCachedKey(1n, new Uint8Array(32));
    clearCachedKey(1n);
    expect(getCachedKey(1n)).toBeUndefined();
  });
});
