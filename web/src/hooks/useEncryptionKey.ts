import { useEffect, useState } from 'react';
import { generateKeypair, publicFromPrivate, storageKeyFor } from '../utils/encryptionKey';
import { createSessionStorage, type SessionStorage } from './useSessionStorage';

export interface EncryptionKeyState {
  publicKey: Uint8Array | null;
  privateKey: Uint8Array | null;
  ready: boolean;
}

export interface UseEncryptionKeyOptions {
  storage?: SessionStorage;
}

/**
 * Ensure-or-create a per-account x25519 keypair. The private half is
 * persisted via `SessionStorage`; the public half is derived in-memory
 * whenever the private half loads.
 */
export function useEncryptionKey(
  address: string | null,
  opts: UseEncryptionKeyOptions = {},
): EncryptionKeyState {
  const storage = opts.storage ?? createSessionStorage();
  const [state, setState] = useState<EncryptionKeyState>({
    publicKey: null,
    privateKey: null,
    ready: false,
  });

  useEffect(() => {
    if (!address) {
      setState({ publicKey: null, privateKey: null, ready: false });
      return;
    }

    let cancelled = false;
    const key = storageKeyFor(address);

    (async () => {
      let privateKey = await storage.readBytes(key);
      if (!privateKey) {
        const kp = await generateKeypair();
        privateKey = kp.privateKey;
        await storage.writeBytes(key, privateKey);
      }
      const publicKey = await publicFromPrivate(privateKey);
      if (!cancelled) setState({ publicKey, privateKey, ready: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [address, storage]);

  return state;
}
