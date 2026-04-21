import { describe, expect, it } from 'vitest';
import _sodium from 'libsodium-wrappers';
import { openSealed, sealTo } from './sealedBox';

describe('sealedBox', () => {
  it('round-trips a 32-byte payload through libsodium crypto_box_keypair', async () => {
    await _sodium.ready;
    const kp = _sodium.crypto_box_keypair();
    const plaintext = new Uint8Array(32).fill(0x42);

    const sealed = await sealTo(kp.publicKey, plaintext);
    expect(sealed.length).toBe(80);

    const recovered = await openSealed(kp.publicKey, kp.privateKey, sealed);
    expect(Array.from(recovered)).toEqual(Array.from(plaintext));
  });

  it('rejects a sealed payload opened with the wrong private key', async () => {
    await _sodium.ready;
    const victim = _sodium.crypto_box_keypair();
    const attacker = _sodium.crypto_box_keypair();
    const sealed = await sealTo(victim.publicKey, new Uint8Array(32));
    await expect(
      openSealed(victim.publicKey, attacker.privateKey, sealed),
    ).rejects.toThrow();
  });

  it('throws when sealed length is not 80', async () => {
    await _sodium.ready;
    const kp = _sodium.crypto_box_keypair();
    await expect(openSealed(kp.publicKey, kp.privateKey, new Uint8Array(79))).rejects.toThrow(
      /80/,
    );
  });

  it('throws when plaintext length is not 32', async () => {
    await _sodium.ready;
    const kp = _sodium.crypto_box_keypair();
    await expect(sealTo(kp.publicKey, new Uint8Array(31))).rejects.toThrow(/32/);
  });
});
