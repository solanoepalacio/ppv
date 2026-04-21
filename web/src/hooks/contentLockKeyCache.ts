// Module-level cache. Populated by CreatePage after upload so the creator's
// freshly-created listing plays back in the same session without waiting for
// the content-unlock-service daemon. Cleared on tab close; never persisted.

const _cache = new Map<bigint, Uint8Array>();

export function setCachedKey(listingId: bigint, key: Uint8Array): void {
  _cache.set(listingId, key);
}

export function getCachedKey(listingId: bigint): Uint8Array | undefined {
  return _cache.get(listingId);
}

export function clearCachedKey(listingId: bigint): void {
  _cache.delete(listingId);
}
