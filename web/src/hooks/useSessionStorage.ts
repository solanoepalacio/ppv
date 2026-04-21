import { hostLocalStorage, sandboxProvider } from '@novasamatech/product-sdk';

export interface SessionStorage {
  readBytes(key: string): Promise<Uint8Array | null>;
  writeBytes(key: string, value: Uint8Array): Promise<void>;
}

export interface SessionStorageOptions {
  inSandbox?: boolean;
  host?: { readBytes: (k: string) => Promise<Uint8Array>; writeBytes: (k: string, v: Uint8Array) => Promise<void> };
}

/**
 * Session-storage adapter. In the Triangle sandbox it routes through
 * `hostLocalStorage` (host-mediated, per-product namespaced). In dev mode
 * it falls back to `window.localStorage` with base64 framing.
 *
 * Args are optional; defaults are production shape. Tests pass explicit
 * flags + mocks to exercise both branches without JSDOM sandbox emulation.
 */
export function createSessionStorage(opts: SessionStorageOptions = {}): SessionStorage {
  const inSandbox = opts.inSandbox ?? sandboxProvider.isCorrectEnvironment();
  const host = opts.host ?? hostLocalStorage;

  if (inSandbox) {
    return {
      async readBytes(key) {
        try {
          return await host.readBytes(key);
        } catch {
          return null;
        }
      },
      async writeBytes(key, value) {
        await host.writeBytes(key, value);
      },
    };
  }

  return {
    async readBytes(key) {
      const b64 = window.localStorage.getItem(key);
      if (b64 === null) return null;
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    async writeBytes(key, value) {
      let bin = '';
      for (const b of value) bin += String.fromCharCode(b);
      window.localStorage.setItem(key, btoa(bin));
    },
  };
}

export const sessionStorage: SessionStorage = createSessionStorage();
