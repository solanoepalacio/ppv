import { sodiumReady } from './sodium';

/**
 * NaCl sealed-box: wrap a 32-byte payload to a recipient's x25519 pubkey.
 * Output layout: 32-byte ephemeral pub ‖ 32-byte ciphertext ‖ 16-byte MAC = 80 bytes.
 * Interoperates byte-for-byte with `crypto_box_seal` in the Rust daemon
 * (`offchain/content-unlock-service/src/crypto.rs`).
 */
export async function sealTo(
  recipientPub: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  if (plaintext.length !== 32) {
    throw new Error(`sealTo expects 32-byte plaintext, got ${plaintext.length}`);
  }
  const sodium = await sodiumReady();
  const sealed = sodium.crypto_box_seal(plaintext, recipientPub);
  if (sealed.length !== 80) {
    throw new Error(`sealed length ${sealed.length} (expected 80)`);
  }
  return sealed;
}

/**
 * Open an 80-byte sealed-box back into its 32-byte plaintext using
 * the recipient's x25519 keypair.
 */
export async function openSealed(
  recipientPub: Uint8Array,
  recipientPriv: Uint8Array,
  sealed: Uint8Array,
): Promise<Uint8Array> {
  if (sealed.length !== 80) {
    throw new Error(`openSealed expects 80-byte input, got ${sealed.length}`);
  }
  const sodium = await sodiumReady();
  const plaintext = sodium.crypto_box_seal_open(sealed, recipientPub, recipientPriv);
  if (plaintext.length !== 32) {
    throw new Error(`unsealed length ${plaintext.length} (expected 32)`);
  }
  return plaintext;
}
