import { blake2b } from 'blakejs';

/**
 * Returns true if blake2b-256(bytes) equals expectedHash.
 * Used to verify content integrity after fetching from IPFS.
 */
export function verifyContentHash(bytes: Uint8Array, expectedHash: Uint8Array): boolean {
  const actual = blake2b(bytes, undefined, 32);
  if (actual.length !== expectedHash.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expectedHash[i]) return false;
  }
  return true;
}
