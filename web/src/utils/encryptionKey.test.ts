import { describe, expect, it } from 'vitest';
import _sodium from 'libsodium-wrappers';
import {
  generateKeypair,
  publicFromPrivate,
  storageKeyFor,
} from './encryptionKey';

describe('encryptionKey', () => {
  it('generates a 32/32-byte x25519 keypair', async () => {
    const { publicKey, privateKey } = await generateKeypair();
    expect(publicKey.length).toBe(32);
    expect(privateKey.length).toBe(32);
  });

  it('publicFromPrivate derives the same pubkey libsodium produced', async () => {
    await _sodium.ready;
    const { publicKey, privateKey } = await generateKeypair();
    const derived = await publicFromPrivate(privateKey);
    expect(Array.from(derived)).toEqual(Array.from(publicKey));
  });

  it('namespaces storage keys by address', () => {
    const a = storageKeyFor('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
    const b = storageKeyFor('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty');
    expect(a).not.toBe(b);
    expect(a.startsWith('ppview:x25519:')).toBe(true);
  });
});
