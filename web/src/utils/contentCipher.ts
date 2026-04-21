import { sodiumReady } from './sodium';

const NONCE_BYTES = 24;
const MAC_BYTES = 16;

/**
 * Random 32-byte symmetric content-lock-key. One per content item.
 * Never persisted or transmitted in the clear — it is wrapped with
 * sealed-box before leaving the browser.
 */
export function generateContentLockKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  return key;
}

/**
 * Encrypt `plaintext` under `key` with XSalsa20-Poly1305.
 * Returns `nonce ‖ ciphertext ‖ MAC`.
 */
export async function encryptContent(
  plaintext: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  const nonce = sodium.randombytes_buf(NONCE_BYTES);
  const ct = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return out;
}

/**
 * Split the stored wire into its nonce and sealed payload, then decrypt.
 * Throws on length mismatch, wrong key, or tampered bytes.
 */
export async function decryptContent(
  wire: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  if (wire.length < NONCE_BYTES + MAC_BYTES) {
    throw new Error(`ciphertext too short: ${wire.length}`);
  }
  const sodium = await sodiumReady();
  const nonce = wire.subarray(0, NONCE_BYTES);
  const ct = wire.subarray(NONCE_BYTES);
  return sodium.crypto_secretbox_open_easy(ct, nonce, key);
}
