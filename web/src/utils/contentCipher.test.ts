import { describe, expect, it } from 'vitest';
import _sodium from 'libsodium-wrappers';
import { decryptContent, encryptContent, generateContentLockKey } from './contentCipher';

describe('contentCipher', () => {
  it('round-trips bytes through encrypt + decrypt with the same key', async () => {
    await _sodium.ready;
    const key = generateContentLockKey();
    const plaintext = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const wire = await encryptContent(plaintext, key);
    expect(wire.length).toBe(24 + plaintext.length + 16); // nonce + ct + mac
    const recovered = await decryptContent(wire, key);
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it('produces a different wire each call (random nonce)', async () => {
    await _sodium.ready;
    const key = generateContentLockKey();
    const plaintext = new Uint8Array(64).fill(0xaa);
    const a = await encryptContent(plaintext, key);
    const b = await encryptContent(plaintext, key);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('fails to decrypt under a wrong key', async () => {
    await _sodium.ready;
    const wire = await encryptContent(new Uint8Array(16), generateContentLockKey());
    await expect(decryptContent(wire, generateContentLockKey())).rejects.toThrow();
  });

  it('fails to decrypt when ciphertext is tampered', async () => {
    await _sodium.ready;
    const key = generateContentLockKey();
    const wire = await encryptContent(new Uint8Array(16).fill(0x11), key);
    wire[30] ^= 0x01;
    await expect(decryptContent(wire, key)).rejects.toThrow();
  });

  it('rejects a wire shorter than nonce + MAC', async () => {
    await _sodium.ready;
    await expect(
      decryptContent(new Uint8Array(39), generateContentLockKey()),
    ).rejects.toThrow(/too short/);
  });

  it('generates a 32-byte symmetric key', () => {
    const key = generateContentLockKey();
    expect(key.length).toBe(32);
  });
});
