import { sodiumReady } from './sodium';

export interface X25519Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Generate a fresh x25519 keypair via libsodium's `crypto_box_keypair`.
 */
export async function generateKeypair(): Promise<X25519Keypair> {
  const sodium = await sodiumReady();
  const kp = sodium.crypto_box_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

/**
 * Derive the x25519 public key for an existing private key. Used to
 * reconstruct the pubkey after loading a persisted private key.
 */
export async function publicFromPrivate(privateKey: Uint8Array): Promise<Uint8Array> {
  const sodium = await sodiumReady();
  return sodium.crypto_scalarmult_base(privateKey);
}

/**
 * Namespaced storage key. Inside a Triangle sandbox the host already
 * scopes by product, so the `ppview` prefix is defensive; in dev mode
 * it prevents collisions with other app data.
 */
export function storageKeyFor(address: string): string {
  return `ppview:x25519:${address}`;
}
