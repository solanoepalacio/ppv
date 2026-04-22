# P2c — Frontend Encryption Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Phase 2 end-to-end in the browser — generate/persist a per-account x25519 keypair, encrypt content before upload, seal the content-lock-key to `SVC_PUB`, batch `register_encryption_key` with the first `create_listing` / `purchase`, subscribe to `WrappedKeys[(account, listing_id)]`, unseal, decrypt, and render — against the pallet (P2a) and the content-unlock-service daemon (P2b) already merged on `main`.

**Architecture:** Pure-JS crypto via `libsodium-wrappers` (already in `package.json`). Sealed-box (`crypto_box_seal` / `crypto_box_seal_open`) wraps the 32-byte content-lock-key to a 32-byte x25519 pubkey → 80-byte output matching the pallet type. Content is encrypted with `crypto_secretbox_easy` using a random 24-byte nonce; stored bytes on Bulletin are `nonce ‖ ciphertext ‖ MAC`. The x25519 private key is persisted via the Triangle host's `createLocalStorage` in sandbox mode and plain `window.localStorage` in dev mode, keyed by account SS58. Batched first-writes use `pallet-utility::batch_all`. The creator fast-path is a module-level `Map<listingId, Uint8Array>` that holds the plaintext content-lock-key for the remainder of the browser session. Decryption lives in `VideoPlayer`, which either reads the cached CLK (creator, same session) or subscribes to `WrappedKeys`, unseals, and decrypts.

**Tech Stack:** React 18, Vite 6, `polkadot-api` 1.23, `@novasamatech/product-sdk` 0.6 (for `createLocalStorage`), `libsodium-wrappers` 0.7 (already installed), `blakejs` (already installed), `@parity/bulletin-sdk` 0.1, Vitest 2.

**Prerequisites:**
- P2a Tasks 1–10 merged: `ServicePublicKey`, `ServiceAccountId`, `EncryptionKeys`, `WrappedKeys`, `register_encryption_key`, `grant_access`, `locked_content_lock_key: [u8; 80]` enforced. (All boxes ticked.)
- P2b Tasks 1–10 merged: daemon observes `PurchaseCompleted` + `ListingCreated` and writes `WrappedKeys`. (All boxes ticked.)
- PAPI descriptors already regenerated against the Phase 2 metadata (commit `d1e2aef`).
- `keys/svc_signer.suri` + `keys/svc_box_key.pem` exist locally (genesis preset populates `ServiceAccountId` and `ServicePublicKey` from them).

**Scope carve-outs (not in this plan):**
- Session-key-loss recovery (`regrant_access`) — Phase 4.
- Service-key rotation — Phase 5.
- Chunked Bulletin upload above 2 MiB — still blocked on SDK bug; unchanged from P1b.
- Stablecoin payments — Phase 3.

**Known limitation carried from P1b:** The 2 MiB `MAX_UPLOAD_BYTES` cap already means the ciphertext (plaintext + 16-byte MAC, with the 24-byte nonce stored alongside) must fit in 2 MiB. Concretely, plaintext videos must be ≤ `2·1024·1024 − 40` bytes. Reuse the existing file-size guard in `CreatePage`; no new check needed.

---

## File Structure

**Created:**
- `web/src/utils/sodium.ts` — memoized `await sodium.ready`, exports the ready libsodium namespace
- `web/src/utils/sealedBox.ts` — `sealTo(pubkey, plaintext)` / `openSealed(pubkey, privkey, sealed)` (80-byte wire)
- `web/src/utils/sealedBox.test.ts`
- `web/src/utils/contentCipher.ts` — `encryptContent(plaintext, key)` / `decryptContent(bytes, key)` (prepended 24-byte nonce)
- `web/src/utils/contentCipher.test.ts`
- `web/src/utils/encryptionKey.ts` — `generateKeypair()`, `publicFromPrivate(priv)`, `storageKeyFor(address)`; pure-function wrappers over libsodium `crypto_box_keypair`
- `web/src/utils/encryptionKey.test.ts`
- `web/src/hooks/useSessionStorage.ts` — thin adapter exposing `{ readBytes(key), writeBytes(key, value) }` backed by `hostLocalStorage` inside the Triangle sandbox and `window.localStorage` otherwise
- `web/src/hooks/useSessionStorage.test.ts`
- `web/src/hooks/useEncryptionKey.ts` — ensures an x25519 keypair exists for the current account, exposes `{ pubkey, privkey, ready }`
- `web/src/hooks/useEncryptionKey.test.ts`
- `web/src/hooks/contentLockKeyCache.ts` — module-level `Map<bigint, Uint8Array>` with `set(id, key)` / `get(id)` / `clear(id)`; creator fast-path only
- `web/src/hooks/contentLockKeyCache.test.ts`

**Modified:**
- `web/src/hooks/useContentRegistry.ts` — add `fetchServicePublicKey`, `fetchEncryptionKey`, `watchWrappedKey`; rework `submitCreateListing` to require a 80-byte `lockedContentLockKey`; add `submitRegisterEncryptionKey`, `submitCreateListingMaybeBatched`, `submitPurchaseMaybeBatched`
- `web/src/pages/CreatePage.tsx` — add generate-key / encrypt / seal / batch steps to the checklist; cache plaintext CLK
- `web/src/pages/ListingDetailPage.tsx` — introduce `awaiting-wrapped-key` state, pass context into `VideoPlayer`, drop the creator-is-purchased shortcut so creators also flow through Phase-2 states
- `web/src/components/VideoPlayer.tsx` — accept `listingId`, `currentAccount`, optional `plaintextKey`; subscribe `WrappedKeys`; decrypt before playback
- `web/src/components/VideoPlayer.test.tsx` — cover the new states

**Untouched but relied upon:**
- `web/src/hooks/useBulletinUpload.ts` — `uploadToBulletin` is the same; encrypted content simply flows through it
- `web/src/utils/contentHash.ts` — `verifyContentHash(plaintext, hash)` is still applied, but now to decrypted plaintext, not fetched bytes
- `web/src/hooks/useParachainProvider.ts` — unchanged (no new signer needed; user signs `register_encryption_key`, `create_listing`, `purchase`, and any `batch_all` wrapper)

---

## Task 1 — `sodium.ts` helper + sealed-box utility (TDD)

**Files:**
- Create: `web/src/utils/sodium.ts`
- Create: `web/src/utils/sealedBox.ts`
- Create: `web/src/utils/sealedBox.test.ts`

**Why it's first:** Every subsequent encryption task depends on a single awaited `libsodium` instance. The sealed-box wrapper is tested against libsodium's own keypair so interop with the Rust daemon (which uses `crypto_box`) is implicit — both conform to NaCl's 48-byte overhead on a 32-byte payload.

- [ ] **Step 1: Write the failing tests**

Create `web/src/utils/sealedBox.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest --run src/utils/sealedBox.test.ts`
Expected: FAIL with "Cannot find module './sealedBox'".

- [ ] **Step 3: Implement `sodium.ts`**

Create `web/src/utils/sodium.ts`:

```ts
import _sodium from 'libsodium-wrappers';

let _ready: Promise<typeof _sodium> | null = null;

/**
 * Memoized libsodium init. Every caller awaits this before touching
 * `_sodium.*` APIs; the promise resolves once for the lifetime of the
 * page.
 */
export function sodiumReady(): Promise<typeof _sodium> {
  if (!_ready) _ready = _sodium.ready.then(() => _sodium);
  return _ready;
}
```

- [ ] **Step 4: Implement `sealedBox.ts`**

Create `web/src/utils/sealedBox.ts`:

```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest --run src/utils/sealedBox.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add web/src/utils/sodium.ts web/src/utils/sealedBox.ts web/src/utils/sealedBox.test.ts
git commit -m "feat(web): sealed-box utility + sodium init helper"
```

---

## Task 2 — Content encryption utility (TDD)

**Files:**
- Create: `web/src/utils/contentCipher.ts`
- Create: `web/src/utils/contentCipher.test.ts`

**Why:** Encrypts video bytes with `crypto_secretbox_easy`. Wire format stored on Bulletin: `nonce (24) ‖ ciphertext ‖ MAC`. Decryption reverses the split.

- [ ] **Step 1: Write the failing tests**

Create `web/src/utils/contentCipher.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest --run src/utils/contentCipher.test.ts`
Expected: FAIL ("Cannot find module './contentCipher'").

- [ ] **Step 3: Implement `contentCipher.ts`**

Create `web/src/utils/contentCipher.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest --run src/utils/contentCipher.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/utils/contentCipher.ts web/src/utils/contentCipher.test.ts
git commit -m "feat(web): secretbox content encryption utility"
```

---

## Task 3 — x25519 keypair utility (TDD)

**Files:**
- Create: `web/src/utils/encryptionKey.ts`
- Create: `web/src/utils/encryptionKey.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/utils/encryptionKey.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest --run src/utils/encryptionKey.test.ts`
Expected: FAIL ("Cannot find module './encryptionKey'").

- [ ] **Step 3: Implement `encryptionKey.ts`**

Create `web/src/utils/encryptionKey.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest --run src/utils/encryptionKey.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/utils/encryptionKey.ts web/src/utils/encryptionKey.test.ts
git commit -m "feat(web): x25519 keypair utility"
```

---

## Task 4 — Session-storage adapter (host vs dev) (TDD)

**Files:**
- Create: `web/src/hooks/useSessionStorage.ts`
- Create: `web/src/hooks/useSessionStorage.test.ts`

**Why:** Spec §6 bans direct `localStorage` access inside the Triangle sandbox — the host's `createLocalStorage` primitive is the only supported path. In dev mode (Zombienet, `sandboxProvider.isCorrectEnvironment() === false`) we fall back to plain `window.localStorage`. One adapter with a byte-oriented API matches what both the host primitive and our use case need.

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/useSessionStorage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionStorage } from './useSessionStorage';

describe('createSessionStorage (dev mode)', () => {
  beforeEach(() => {
    // jsdom-flavored localStorage is shared per test file; clear before each.
    globalThis.localStorage?.clear();
  });

  it('writes and reads bytes via window.localStorage when not in sandbox', async () => {
    const storage = createSessionStorage({ inSandbox: false });
    await storage.writeBytes('k', new Uint8Array([1, 2, 3]));
    const got = await storage.readBytes('k');
    expect(Array.from(got!)).toEqual([1, 2, 3]);
  });

  it('returns null when key is missing', async () => {
    const storage = createSessionStorage({ inSandbox: false });
    expect(await storage.readBytes('missing')).toBeNull();
  });

  it('delegates to the host primitive when in sandbox', async () => {
    const hostWrite = vi.fn().mockResolvedValue(undefined);
    const hostRead = vi.fn().mockResolvedValue(new Uint8Array([9]));
    const storage = createSessionStorage({
      inSandbox: true,
      host: { writeBytes: hostWrite, readBytes: hostRead },
    });
    await storage.writeBytes('k', new Uint8Array([9]));
    expect(hostWrite).toHaveBeenCalledWith('k', new Uint8Array([9]));
    const got = await storage.readBytes('k');
    expect(hostRead).toHaveBeenCalledWith('k');
    expect(Array.from(got!)).toEqual([9]);
  });
});
```

Add a jsdom environment to the Vitest config so `window.localStorage` is available. Modify `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
});
```

(The `test-setup.ts` file already exists and is reused from P1b.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest --run src/hooks/useSessionStorage.test.ts`
Expected: FAIL ("Cannot find module './useSessionStorage'").

- [ ] **Step 3: Implement `useSessionStorage.ts`**

Create `web/src/hooks/useSessionStorage.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest --run src/hooks/useSessionStorage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/vitest.config.ts web/src/hooks/useSessionStorage.ts web/src/hooks/useSessionStorage.test.ts
git commit -m "feat(web): session-storage adapter with host/dev fallback"
```

---

## Task 5 — `useEncryptionKey` hook (TDD)

**Files:**
- Create: `web/src/hooks/useEncryptionKey.ts`
- Create: `web/src/hooks/useEncryptionKey.test.ts`

**Why:** The hook is responsible for the invariant "every connected account has an x25519 keypair locally". React components don't need to care whether it was just minted or loaded. The private key and derived public key hold in React state so downstream code reads them synchronously once `ready === true`.

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/useEncryptionKey.test.ts`:

```ts
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useEncryptionKey } from './useEncryptionKey';
import { createSessionStorage } from './useSessionStorage';

const ADDR = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

describe('useEncryptionKey', () => {
  it('generates a keypair on first run and persists the private half', async () => {
    window.localStorage.clear();
    const storage = createSessionStorage({ inSandbox: false });

    const { result } = renderHook(() => useEncryptionKey(ADDR, { storage }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.publicKey).toHaveLength(32);
    expect(result.current.privateKey).toHaveLength(32);

    const stored = await storage.readBytes(`ppview:x25519:${ADDR}`);
    expect(stored).not.toBeNull();
    expect(Array.from(stored!)).toEqual(Array.from(result.current.privateKey!));
  });

  it('loads an existing private key instead of regenerating', async () => {
    window.localStorage.clear();
    const storage = createSessionStorage({ inSandbox: false });
    const existing = new Uint8Array(32).fill(0x11);
    await storage.writeBytes(`ppview:x25519:${ADDR}`, existing);

    const { result } = renderHook(() => useEncryptionKey(ADDR, { storage }));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(Array.from(result.current.privateKey!)).toEqual(Array.from(existing));
  });

  it('returns ready=false while address is null', async () => {
    const { result } = renderHook(() => useEncryptionKey(null));
    expect(result.current.ready).toBe(false);
    expect(result.current.publicKey).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest --run src/hooks/useEncryptionKey.test.ts`
Expected: FAIL ("Cannot find module './useEncryptionKey'").

- [ ] **Step 3: Implement `useEncryptionKey.ts`**

Create `web/src/hooks/useEncryptionKey.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest --run src/hooks/useEncryptionKey.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useEncryptionKey.ts web/src/hooks/useEncryptionKey.test.ts
git commit -m "feat(web): useEncryptionKey hook — ensure-or-create per-account x25519 keypair"
```

---

## Task 6 — Content-lock-key in-memory cache (TDD)

**Files:**
- Create: `web/src/hooks/contentLockKeyCache.ts`
- Create: `web/src/hooks/contentLockKeyCache.test.ts`

**Why:** Spec §5 creator fast-path: after upload, retain the plaintext content-lock-key in memory so the creator can play back immediately without waiting for the daemon. Module-level `Map` keyed by `listing_id`. **Not persisted** — reloads fall through to the regular `WrappedKeys` path.

- [ ] **Step 1: Write the failing test**

Create `web/src/hooks/contentLockKeyCache.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCachedKey, getCachedKey, setCachedKey } from './contentLockKeyCache';

describe('contentLockKeyCache', () => {
  beforeEach(() => {
    clearCachedKey(1n);
    clearCachedKey(2n);
  });

  it('stores and retrieves by bigint listing id', () => {
    const k = new Uint8Array(32).fill(0xab);
    setCachedKey(1n, k);
    expect(Array.from(getCachedKey(1n)!)).toEqual(Array.from(k));
  });

  it('returns undefined for unknown ids', () => {
    expect(getCachedKey(2n)).toBeUndefined();
  });

  it('clear removes the entry', () => {
    setCachedKey(1n, new Uint8Array(32));
    clearCachedKey(1n);
    expect(getCachedKey(1n)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest --run src/hooks/contentLockKeyCache.test.ts`
Expected: FAIL ("Cannot find module './contentLockKeyCache'").

- [ ] **Step 3: Implement `contentLockKeyCache.ts`**

Create `web/src/hooks/contentLockKeyCache.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd web && npx vitest --run src/hooks/contentLockKeyCache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/contentLockKeyCache.ts web/src/hooks/contentLockKeyCache.test.ts
git commit -m "feat(web): in-memory content-lock-key cache for creator fast-path"
```

---

## Task 7 — Extend `useContentRegistry` with Phase-2 reads and typed 80-byte writes

**Files:**
- Modify: `web/src/hooks/useContentRegistry.ts`

**Why:** The Phase-1 `submitCreateListing` submits `locked_content_lock_key: Binary.fromBytes(new Uint8Array())`. That already fails on the current runtime because `locked_content_lock_key` is now `[u8; 80]`. This task tightens the parameter type, drops the empty-bytes default, and adds the Phase-2 reads every other task will call.

Scope (no TDD here — these are mostly one-line `api.query.*` wrappers; Vitest can't spin up a PAPI client without a mock runtime, which is disproportionate for wrappers this thin. The E2E script in Task 12 exercises them end-to-end.)

- [ ] **Step 1: Replace the file body**

Overwrite `web/src/hooks/useContentRegistry.ts`:

```ts
import { Binary, FixedSizeBinary, type PolkadotSigner } from 'polkadot-api';
import { getParachainApi, getUserSigner } from './useParachainProvider';
import { bulletinCidToGatewayUrl } from '../utils/bulletinCid';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface BulletinCidFields {
  codec: number;
  digestBytes: Uint8Array;
}

export interface Listing {
  id: bigint;
  creator: string;
  price: bigint;
  contentCid: BulletinCidFields;
  thumbnailCid: BulletinCidFields;
  thumbnailUrl: string;
  contentHash: Uint8Array;
  title: string;
  description: string;
  createdAt: number;
}

// ── Internal mapper (exported for testing) ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapListing(id: bigint, l: any): Listing {
  const thumbnailCid: BulletinCidFields = {
    codec: l.thumbnail_cid.codec,
    digestBytes: l.thumbnail_cid.digest.asBytes(),
  };
  return {
    id,
    creator: l.creator,
    price: l.price,
    contentCid: { codec: l.content_cid.codec, digestBytes: l.content_cid.digest.asBytes() },
    thumbnailCid,
    thumbnailUrl: bulletinCidToGatewayUrl(thumbnailCid.codec, thumbnailCid.digestBytes),
    contentHash: l.content_hash.asBytes(),
    title: l.title.asText(),
    description: l.description.asText(),
    createdAt: l.created_at,
  };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function fetchAllListings(): Promise<Listing[]> {
  const api = getParachainApi();
  const entries = await api.query.ContentRegistry.Listings.getEntries();
  return entries
    .map(({ keyArgs: [id], value: l }) => mapListing(id, l))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function fetchListing(id: bigint): Promise<Listing | undefined> {
  const api = getParachainApi();
  const l = await api.query.ContentRegistry.Listings.getValue(id);
  if (!l) return undefined;
  return mapListing(id, l);
}

export async function fetchPurchases(
  address: string,
): Promise<Array<{ listingId: bigint; blockNumber: number }>> {
  const api = getParachainApi();
  const entries = await api.query.ContentRegistry.Purchases.getEntries(address);
  return entries
    .map(({ keyArgs: [, listingId], value: blockNumber }) => ({
      listingId: listingId as bigint,
      blockNumber: blockNumber as number,
    }))
    .sort((a, b) => b.blockNumber - a.blockNumber);
}

export async function hasPurchased(address: string, listingId: bigint): Promise<boolean> {
  const api = getParachainApi();
  const result = await api.query.ContentRegistry.Purchases.getValue(address, listingId);
  return result !== undefined;
}

/** Read the 32-byte SVC_PUB baked into genesis. Panics on misconfigured chains. */
export async function fetchServicePublicKey(): Promise<Uint8Array> {
  const api = getParachainApi();
  const pub = await api.query.ContentRegistry.ServicePublicKey.getValue();
  return pub.asBytes();
}

/** Returns the registered x25519 pubkey for `address`, or null if none. */
export async function fetchEncryptionKey(address: string): Promise<Uint8Array | null> {
  const api = getParachainApi();
  const entry = await api.query.ContentRegistry.EncryptionKeys.getValue(address);
  return entry ? entry.asBytes() : null;
}

/**
 * Subscribe to `WrappedKeys[(address, listingId)]`. Emits `null` until
 * the daemon writes it, then emits the 80-byte sealed payload.
 */
export function watchWrappedKey(
  address: string,
  listingId: bigint,
  onChange: (sealed: Uint8Array | null) => void,
): { unsubscribe: () => void } {
  const api = getParachainApi();
  const sub = api.query.ContentRegistry.WrappedKeys.watchValue(address, listingId).subscribe({
    next: (v) => onChange(v ? v.asBytes() : null),
    error: (err) => console.error('WrappedKeys subscription error:', err),
  });
  return { unsubscribe: () => sub.unsubscribe() };
}

// ── Writes ────────────────────────────────────────────────────────────────────

export interface CreateListingParams {
  contentCid: BulletinCidFields;
  thumbnailCid: BulletinCidFields;
  contentHash: Uint8Array;
  title: string;
  description: string;
  price: bigint;
  lockedContentLockKey: Uint8Array; // exactly 80 bytes, sealed to SVC_PUB
}

function createListingCall(params: CreateListingParams) {
  const api = getParachainApi();
  if (params.lockedContentLockKey.length !== 80) {
    throw new Error(
      `lockedContentLockKey must be 80 bytes, got ${params.lockedContentLockKey.length}`,
    );
  }
  return api.tx.ContentRegistry.create_listing({
    content_cid: {
      codec: params.contentCid.codec,
      digest: FixedSizeBinary.fromBytes(params.contentCid.digestBytes),
    },
    thumbnail_cid: {
      codec: params.thumbnailCid.codec,
      digest: FixedSizeBinary.fromBytes(params.thumbnailCid.digestBytes),
    },
    content_hash: FixedSizeBinary.fromBytes(params.contentHash),
    title: Binary.fromText(params.title),
    description: Binary.fromText(params.description),
    price: params.price,
    locked_content_lock_key: FixedSizeBinary.fromBytes(params.lockedContentLockKey),
  });
}

function registerEncryptionKeyCall(pubkey: Uint8Array) {
  const api = getParachainApi();
  if (pubkey.length !== 32) throw new Error(`pubkey must be 32 bytes, got ${pubkey.length}`);
  return api.tx.ContentRegistry.register_encryption_key({
    pubkey: FixedSizeBinary.fromBytes(pubkey),
  });
}

function purchaseCall(listingId: bigint) {
  const api = getParachainApi();
  return api.tx.ContentRegistry.purchase({ listing_id: listingId });
}

/** Plain `create_listing`. Caller must have `EncryptionKeys[caller]` already. */
export async function submitCreateListing(params: CreateListingParams): Promise<bigint> {
  const api = getParachainApi();
  const signer = getUserSigner();
  const tx = createListingCall(params);
  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`create_listing failed: ${JSON.stringify(result)}`);
  const nextId = await api.query.ContentRegistry.NextListingId.getValue();
  return nextId - 1n;
}

/** Plain `register_encryption_key`. Rarely called directly — see batch helpers. */
export async function submitRegisterEncryptionKey(pubkey: Uint8Array): Promise<void> {
  const signer = getUserSigner();
  const result = await registerEncryptionKeyCall(pubkey).signAndSubmit(signer);
  if (!result.ok) throw new Error(`register_encryption_key failed: ${JSON.stringify(result)}`);
}

/** Plain `purchase`. Caller must have `EncryptionKeys[caller]` already. */
export async function submitPurchase(listingId: bigint): Promise<void> {
  const signer = getUserSigner();
  const result = await purchaseCall(listingId).signAndSubmit(signer);
  if (!result.ok) throw new Error(`purchase failed: ${JSON.stringify(result)}`);
}

// ── Batched helpers ───────────────────────────────────────────────────────────

async function signBatchAll(
  signer: PolkadotSigner,
  calls: ReturnType<typeof createListingCall>[] | unknown[],
): Promise<void> {
  const api = getParachainApi();
  // Each call is a typed `Tx`; PAPI exposes its enum shape on `.decodedCall`,
  // which is exactly what `Utility.batch_all` expects.
  const inner = calls.map((c) => (c as { decodedCall: unknown }).decodedCall);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = (api.tx as any).Utility.batch_all({ calls: inner });
  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`batch_all failed: ${JSON.stringify(result)}`);
}

/**
 * Create a listing. If `EncryptionKeys[caller]` is missing, batches
 * `register_encryption_key(pubkey)` before `create_listing`. Returns
 * the new `listing_id`.
 */
export async function submitCreateListingMaybeBatched(
  params: CreateListingParams,
  callerAddress: string,
  pubkeyIfMissing: Uint8Array,
): Promise<bigint> {
  const api = getParachainApi();
  const signer = getUserSigner();
  const already = await fetchEncryptionKey(callerAddress);

  if (already) {
    const result = await createListingCall(params).signAndSubmit(signer);
    if (!result.ok) throw new Error(`create_listing failed: ${JSON.stringify(result)}`);
  } else {
    await signBatchAll(signer, [
      registerEncryptionKeyCall(pubkeyIfMissing),
      createListingCall(params),
    ]);
  }

  const nextId = await api.query.ContentRegistry.NextListingId.getValue();
  return nextId - 1n;
}

/**
 * Purchase a listing. If `EncryptionKeys[caller]` is missing, batches
 * `register_encryption_key(pubkey)` before `purchase`.
 */
export async function submitPurchaseMaybeBatched(
  listingId: bigint,
  callerAddress: string,
  pubkeyIfMissing: Uint8Array,
): Promise<void> {
  const signer = getUserSigner();
  const already = await fetchEncryptionKey(callerAddress);

  if (already) {
    const result = await purchaseCall(listingId).signAndSubmit(signer);
    if (!result.ok) throw new Error(`purchase failed: ${JSON.stringify(result)}`);
  } else {
    await signBatchAll(signer, [
      registerEncryptionKeyCall(pubkeyIfMissing),
      purchaseCall(listingId),
    ]);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc -b --noEmit`
Expected: no errors. If `watchValue` on `WrappedKeys` is typed differently after descriptor regeneration, adjust the signature — the runtime contract is the same.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useContentRegistry.ts
git commit -m "feat(web): useContentRegistry Phase-2 reads + batched writes + 80-byte locked key"
```

---

## Task 8 — `CreatePage` — encrypt before upload, seal to SVC_PUB, batched submit, cache CLK

**Files:**
- Modify: `web/src/pages/CreatePage.tsx`

**Why:** Wires Tasks 1–7 into the upload flow exactly as spec §5 `Creator upload flow` + frontend-views §5.3 Section D describe, including the new checklist rows for key generation, encryption, and sealing.

- [ ] **Step 1: Replace the CreatePage implementation**

Overwrite `web/src/pages/CreatePage.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import ThumbnailPicker from '../components/ThumbnailPicker';
import CreateChecklist, { type ChecklistStep, type StepStatus } from '../components/CreateChecklist';
import { uploadToBulletin, MAX_UPLOAD_BYTES } from '../hooks/useBulletinUpload';
import {
  fetchServicePublicKey,
  submitCreateListingMaybeBatched,
} from '../hooks/useContentRegistry';
import { useEncryptionKey } from '../hooks/useEncryptionKey';
import { setCachedKey } from '../hooks/contentLockKeyCache';
import { encryptContent, generateContentLockKey } from '../utils/contentCipher';
import { sealTo } from '../utils/sealedBox';
import { getContentHash, HashAlgorithm } from '@parity/bulletin-sdk';

type Section = 'A' | 'B' | 'C' | 'D';

function CharCounter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={`text-xs ${over ? 'text-accent-red' : 'text-text-muted'}`}>
      {value.length}/{max}
    </span>
  );
}

export default function CreatePage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ name: string; size: string; duration: string } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [thumbnailBytes, setThumbnailBytes] = useState<Uint8Array | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceInput, setPriceInput] = useState('');

  const navigate = useNavigate();
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [steps, setSteps] = useState<ChecklistStep[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const account = useChainStore((s) => s.account);
  const encryptionKey = useEncryptionKey(account);

  const pricePlanck = priceInput ? BigInt(Math.round(parseFloat(priceInput) * 1e10)) : 0n;

  const section: Section =
    !videoFile ? 'A'
    : !thumbnailBytes ? 'B'
    : title.length < 1 || description.length < 1 || !priceInput || parseFloat(priceInput) <= 0 ? 'C'
    : 'D';

  function handleFilePick(file: File) {
    setVideoError(null);
    setThumbnailBytes(null);

    if (file.size > MAX_UPLOAD_BYTES - 40) {
      setVideoError('File is too large. Phase-2 PoC supports videos up to ~2 MiB of plaintext (encryption adds 40 bytes).');
      return;
    }

    const offscreen = document.createElement('video') as HTMLVideoElement;
    offscreen.muted = true;
    const url = URL.createObjectURL(file);
    offscreen.src = url;
    offscreen.onloadedmetadata = () => {
      const mins = Math.floor(offscreen.duration / 60);
      const secs = Math.floor(offscreen.duration % 60);
      setVideoInfo({
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(1)} MiB`,
        duration: `${mins}:${secs.toString().padStart(2, '0')}`,
      });
      URL.revokeObjectURL(url);
      setVideoFile(file);
    };
    offscreen.onerror = () => {
      setVideoError("Can't read this file; try another.");
      URL.revokeObjectURL(url);
    };
  }

  useEffect(() => {
    if (!videoFile) { setVideoPreviewUrl(null); return; }
    const url = URL.createObjectURL(videoFile);
    setVideoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFilePick(file);
  }

  function setStep(id: string, status: StepStatus, detail?: string, errorMsg?: string) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, status, detail, errorMsg } : s)),
    );
  }

  async function handleSubmit() {
    if (!videoFile || !thumbnailBytes || !title || !description || pricePlanck <= 0n) return;
    if (!account || !encryptionKey.ready || !encryptionKey.publicKey) {
      setVideoError('Encryption key not ready — refresh and try again.');
      return;
    }

    setSubmitting(true);
    const initialSteps: ChecklistStep[] = [
      { id: 'clk',     label: 'Generating content-lock-key…',         status: 'pending' },
      { id: 'encrypt', label: 'Encrypting content…',                  status: 'pending' },
      { id: 'hash',    label: 'Computing content hash…',              status: 'pending' },
      { id: 'thumb',   label: 'Uploading thumbnail to Bulletin…',     status: 'pending' },
      { id: 'content', label: 'Uploading encrypted content…',         status: 'pending' },
      { id: 'seal',    label: 'Sealing content-lock-key to SVC_PUB…', status: 'pending' },
      { id: 'submit',  label: 'Submitting create_listing…',           status: 'pending' },
    ];
    setSteps(initialSteps);

    try {
      setStep('clk', 'running');
      const contentLockKey = generateContentLockKey();
      setStep('clk', 'done');

      setStep('encrypt', 'running');
      const plaintextBytes = new Uint8Array(await videoFile.arrayBuffer());
      const ciphertextBytes = await encryptContent(plaintextBytes, contentLockKey);
      setStep('encrypt', 'done');

      setStep('hash', 'running');
      const contentHash = await getContentHash(plaintextBytes, HashAlgorithm.Blake2b256);
      setStep('hash', 'done');

      setStep('thumb', 'running');
      const thumbnailCid = await uploadToBulletin(
        thumbnailBytes,
        (pct) => setStep('thumb', 'running', `${Math.round(pct)}%`),
      );
      setStep('thumb', 'done');

      setStep('content', 'running');
      const contentCid = await uploadToBulletin(
        ciphertextBytes,
        (pct) => setStep('content', 'running', `${Math.round(pct)}%`),
      );
      setStep('content', 'done');

      setStep('seal', 'running');
      const svcPub = await fetchServicePublicKey();
      const lockedContentLockKey = await sealTo(svcPub, contentLockKey);
      setStep('seal', 'done');

      setStep('submit', 'running');
      const newId = await submitCreateListingMaybeBatched(
        {
          contentCid,
          thumbnailCid,
          contentHash,
          title,
          description,
          price: pricePlanck,
          lockedContentLockKey,
        },
        account,
        encryptionKey.publicKey,
      );
      setStep('submit', 'done');

      // Creator fast-path: retain plaintext CLK so the just-created listing
      // plays back in-session without waiting for the content-unlock-service.
      setCachedKey(newId, contentLockKey);

      navigate(`/listing/${newId}`);
    } catch (e) {
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.status === 'running');
        if (idx < 0) return prev;
        const updated = [...prev];
        updated[idx] = { ...updated[idx], status: 'error', errorMsg: String(e) };
        return updated;
      });
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-text-primary mb-6">Create listing</h1>

      {/* Section A: Video picker */}
      <div className="mb-6">
        {!videoFile ? (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center cursor-pointer hover:border-polka-500/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <p className="text-text-secondary text-sm mb-2">Drag & drop a video, or</p>
            <button className="text-polka-400 hover:text-polka-300 text-sm underline">
              Choose file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }}
            />
          </div>
        ) : (
          <div className="rounded-xl bg-surface-900 border border-white/[0.06] p-4 flex flex-col gap-2">
            <p className="text-sm text-text-primary font-medium">{videoInfo?.name}</p>
            <p className="text-xs text-text-muted">{videoInfo?.size} · {videoInfo?.duration}</p>
            <video
              src={videoPreviewUrl ?? undefined}
              controls
              className="w-full rounded-lg mt-1"
              style={{ maxHeight: 200 }}
            />
            <button
              onClick={() => { setVideoFile(null); setVideoInfo(null); setThumbnailBytes(null); }}
              className="text-xs text-text-muted hover:text-text-secondary self-start"
            >
              ✕ Remove
            </button>
          </div>
        )}
        {videoError && <p className="text-accent-red text-xs mt-2">{videoError}</p>}
      </div>

      {/* Section B: Thumbnail picker */}
      {videoFile && (
        <div className="mb-6">
          <ThumbnailPicker videoFile={videoFile} onSelect={(bytes) => setThumbnailBytes(bytes)} />
        </div>
      )}

      {/* Section C: Metadata */}
      {videoFile && thumbnailBytes && (
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-text-secondary">Title</label>
              <CharCounter value={title} max={128} />
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={128}
              placeholder="Give your listing a title"
              className="w-full rounded-lg bg-surface-900 border border-white/10 px-3 py-2 text-sm
                         text-text-primary placeholder:text-text-muted focus:outline-none focus:border-polka-500/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-text-secondary">Description</label>
              <CharCounter value={description} max={2048} />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2048}
              rows={4}
              placeholder="Describe your content"
              className="w-full rounded-lg bg-surface-900 border border-white/10 px-3 py-2 text-sm
                         text-text-primary placeholder:text-text-muted focus:outline-none focus:border-polka-500/50 resize-y"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-secondary">Price (DOT)</label>
            <input
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              type="number"
              min="0.0000000001"
              step="0.01"
              placeholder="e.g. 2.5"
              className="w-full rounded-lg bg-surface-900 border border-white/10 px-3 py-2 text-sm
                         text-text-primary placeholder:text-text-muted focus:outline-none focus:border-polka-500/50"
            />
            {pricePlanck > 0n && (
              <p className="text-xs text-text-muted">{String(pricePlanck)} planck</p>
            )}
          </div>
        </div>
      )}

      {section === 'D' && (
        <div className="flex flex-col gap-4">
          {steps.length === 0 ? (
            <button
              data-testid="submit-btn"
              onClick={handleSubmit}
              disabled={submitting || !encryptionKey.ready}
              className="w-full py-2.5 rounded-lg bg-polka-500 hover:bg-polka-400 text-white text-sm
                         font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {encryptionKey.ready ? 'Create listing' : 'Preparing encryption key…'}
            </button>
          ) : (
            <CreateChecklist
              steps={steps}
              onRetry={() => handleSubmit()}
            />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `cd web && npx tsc -b --noEmit && npx eslint src/pages/CreatePage.tsx`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/CreatePage.tsx
git commit -m "feat(web): CreatePage — encrypt content, seal CLK, batched first-listing submit"
```

---

## Task 9 — `VideoPlayer` decrypts via WrappedKeys or cached CLK

**Files:**
- Modify: `web/src/components/VideoPlayer.tsx`
- Modify: `web/src/components/VideoPlayer.test.tsx`

**Why:** `VideoPlayer` is the one place decryption happens. It accepts optional `plaintextKey` (creator fast-path). Without it, it subscribes to `WrappedKeys` for the given `(address, listingId)` pair, unseals to recover the CLK, fetches ciphertext, decrypts, verifies the plaintext hash against `Listing.content_hash`, and plays.

**State machine:**
- `loading` — initial
- `awaiting-key` — WrappedKeys entry not yet present
- `decrypting` — have CLK (from cache or unsealed), fetching+decrypting
- `verified` — blob URL ready
- `integrity-failed` — blake2b mismatch
- `decrypt-failed` — MAC/authentication failure
- `error` — IPFS fetch failure

- [ ] **Step 1: Replace the tests**

Overwrite `web/src/components/VideoPlayer.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import VideoPlayer from './VideoPlayer';
import type { BulletinCidFields } from '../hooks/useContentRegistry';

// Mocks for network + chain dependencies
vi.mock('../hooks/useBulletinUpload', () => ({
  fetchFromIpfs: vi.fn(),
}));
vi.mock('../hooks/useContentRegistry', async (orig) => {
  const actual = await orig<typeof import('../hooks/useContentRegistry')>();
  return {
    ...actual,
    watchWrappedKey: vi.fn(),
  };
});

import { fetchFromIpfs } from '../hooks/useBulletinUpload';
import { watchWrappedKey } from '../hooks/useContentRegistry';
import { encryptContent, generateContentLockKey } from '../utils/contentCipher';
import { sealTo } from '../utils/sealedBox';
import { generateKeypair } from '../utils/encryptionKey';
import { blake2b } from 'blakejs';

const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32) };

beforeEach(() => {
  vi.mocked(fetchFromIpfs).mockReset();
  vi.mocked(watchWrappedKey).mockReset();
  // URL.createObjectURL isn't available in jsdom
  (global as any).URL.createObjectURL = vi.fn(() => 'blob:fake');
  (global as any).URL.revokeObjectURL = vi.fn();
});

describe('VideoPlayer (Phase 2)', () => {
  it('shows "preparing" until the wrapped key lands', async () => {
    vi.mocked(watchWrappedKey).mockImplementation((_a, _id, cb) => {
      cb(null);
      return { unsubscribe: () => {} };
    });
    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={new Uint8Array(32)}
        listingId={1n}
        currentAccount="5Grw"
        viewerPrivateKey={new Uint8Array(32)}
        viewerPublicKey={new Uint8Array(32)}
      />,
    );
    expect(await screen.findByText(/preparing/i)).toBeInTheDocument();
  });

  it('decrypts from WrappedKeys and renders a video blob', async () => {
    const viewer = await generateKeypair();
    const clk = generateContentLockKey();

    const plaintext = new Uint8Array([7, 7, 7, 7]);
    const ciphertext = await encryptContent(plaintext, clk);
    const hash = blake2b(plaintext, undefined, 32);
    const sealed = await sealTo(viewer.publicKey, clk);

    vi.mocked(fetchFromIpfs).mockResolvedValue(ciphertext);
    vi.mocked(watchWrappedKey).mockImplementation((_a, _id, cb) => {
      cb(sealed);
      return { unsubscribe: () => {} };
    });

    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={hash}
        listingId={1n}
        currentAccount="5Grw"
        viewerPublicKey={viewer.publicKey}
        viewerPrivateKey={viewer.privateKey}
      />,
    );

    await waitFor(() => expect(screen.getByText(/content verified/i)).toBeInTheDocument());
  });

  it('uses the cached CLK when provided (creator fast-path)', async () => {
    const clk = generateContentLockKey();
    const plaintext = new Uint8Array([1, 2, 3]);
    const ciphertext = await encryptContent(plaintext, clk);
    const hash = blake2b(plaintext, undefined, 32);

    vi.mocked(fetchFromIpfs).mockResolvedValue(ciphertext);

    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={hash}
        listingId={2n}
        currentAccount="5Grw"
        viewerPublicKey={new Uint8Array(32)}
        viewerPrivateKey={new Uint8Array(32)}
        plaintextKey={clk}
      />,
    );

    await waitFor(() => expect(screen.getByText(/content verified/i)).toBeInTheDocument());
    // We never subscribed because the cached key was sufficient.
    expect(watchWrappedKey).not.toHaveBeenCalled();
  });

  it('flags integrity failure when plaintext hash mismatches', async () => {
    const clk = generateContentLockKey();
    const ciphertext = await encryptContent(new Uint8Array([9]), clk);
    vi.mocked(fetchFromIpfs).mockResolvedValue(ciphertext);

    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={new Uint8Array(32).fill(0x00)}
        listingId={3n}
        currentAccount="5Grw"
        viewerPublicKey={new Uint8Array(32)}
        viewerPrivateKey={new Uint8Array(32)}
        plaintextKey={clk}
      />,
    );

    await waitFor(() => expect(screen.getByText(/integrity check/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail on the old component signature**

Run: `cd web && npx vitest --run src/components/VideoPlayer.test.tsx`
Expected: FAIL — old `VideoPlayer` does not accept the new props.

- [ ] **Step 3: Replace the component**

Overwrite `web/src/components/VideoPlayer.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchFromIpfs } from '../hooks/useBulletinUpload';
import { verifyContentHash } from '../utils/contentHash';
import { watchWrappedKey, type BulletinCidFields } from '../hooks/useContentRegistry';
import { decryptContent } from '../utils/contentCipher';
import { openSealed } from '../utils/sealedBox';

type State =
  | 'loading'
  | 'awaiting-key'
  | 'decrypting'
  | 'verified'
  | 'integrity-failed'
  | 'decrypt-failed'
  | 'error';

interface Props {
  contentCid: BulletinCidFields;
  contentHash: Uint8Array;
  listingId: bigint;
  currentAccount: string;
  viewerPublicKey: Uint8Array;
  viewerPrivateKey: Uint8Array;
  plaintextKey?: Uint8Array; // creator fast-path — supplied by CreatePage session
}

export default function VideoPlayer({
  contentCid,
  contentHash,
  listingId,
  currentAccount,
  viewerPublicKey,
  viewerPrivateKey,
  plaintextKey,
}: Props) {
  const [state, setState] = useState<State>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;

    async function runDecryption(clk: Uint8Array) {
      if (cancelled) return;
      setState('decrypting');
      try {
        const ciphertext = await fetchFromIpfs(contentCid);
        if (cancelled) return;
        let plaintext: Uint8Array;
        try {
          plaintext = await decryptContent(ciphertext, clk);
        } catch {
          if (!cancelled) setState('decrypt-failed');
          return;
        }
        if (cancelled) return;
        if (!verifyContentHash(plaintext, contentHash)) {
          setState('integrity-failed');
          return;
        }
        const blob = new Blob([plaintext], { type: 'video/mp4' });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setState('verified');
      } catch {
        if (!cancelled) setState('error');
      }
    }

    setState('loading');
    setBlobUrl(null);

    // Creator fast-path: skip chain round-trip entirely.
    if (plaintextKey) {
      void runDecryption(plaintextKey);
      return () => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      };
    }

    setState('awaiting-key');
    const sub = watchWrappedKey(currentAccount, listingId, (sealed) => {
      if (!sealed) return; // stay awaiting until the daemon writes it
      openSealed(viewerPublicKey, viewerPrivateKey, sealed)
        .then((clk) => runDecryption(clk))
        .catch(() => {
          if (!cancelled) setState('decrypt-failed');
        });
    });

    return () => {
      cancelled = true;
      sub.unsubscribe();
      if (url) URL.revokeObjectURL(url);
    };
  }, [contentCid, contentHash, listingId, currentAccount, viewerPublicKey, viewerPrivateKey, plaintextKey, retryKey]);

  if (state === 'error') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex flex-col items-center justify-center gap-3">
        <p className="text-text-secondary text-sm">Couldn't reach content storage.</p>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="text-polka-400 hover:text-polka-300 text-sm underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state === 'integrity-failed') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center">
        <p className="text-accent-red text-sm">⚠ Content failed integrity check</p>
      </div>
    );
  }

  if (state === 'decrypt-failed') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center">
        <p className="text-accent-red text-sm">⚠ Decryption failed — wrong key or tampered content</p>
      </div>
    );
  }

  if (state === 'awaiting-key') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex flex-col items-center justify-center gap-3 animate-pulse">
        <div className="w-8 h-8 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
        <p className="text-text-secondary text-xs">Preparing your content…</p>
      </div>
    );
  }

  if (state !== 'verified' || !blobUrl) {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center animate-pulse">
        <div className="w-8 h-8 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-1.5">
      <video controls src={blobUrl} className="w-full rounded-xl bg-black" />
      <p className="text-xs text-accent-green flex items-center gap-1">
        <span>✓</span> Content verified
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest --run src/components/VideoPlayer.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/VideoPlayer.tsx web/src/components/VideoPlayer.test.tsx
git commit -m "feat(web): VideoPlayer decrypts via WrappedKeys or creator cached CLK"
```

---

## Task 10 — `ListingDetailPage` — waiting-for-key state + pass context into VideoPlayer

**Files:**
- Modify: `web/src/pages/ListingDetailPage.tsx`

**Why:** The page remains the state-machine controller. Phase 1's `purchased` terminal state splits into two: the viewer has decryption material (delegate to `VideoPlayer`, which does the rest) vs. the viewer is waiting for it. Post-Phase-2, the creator no longer shortcuts to `purchased` on `account === creator` — the creator flows through the same `WrappedKeys` path as a buyer, with the cached CLK as a fast-path inside `VideoPlayer`. The page itself is simpler.

- [ ] **Step 1: Replace the page body**

Overwrite `web/src/pages/ListingDetailPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import {
  fetchListing,
  hasPurchased,
  submitPurchaseMaybeBatched,
  type Listing,
} from '../hooks/useContentRegistry';
import { useEncryptionKey } from '../hooks/useEncryptionKey';
import { getCachedKey } from '../hooks/contentLockKeyCache';
import VideoPlayer from '../components/VideoPlayer';

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatDot(planck: bigint): string {
  return `${(Number(planck) / 1e10).toFixed(2)} DOT`;
}

type PageState = 'loading' | 'not-found' | 'unpurchased' | 'purchased';

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const account = useChainStore((s) => s.account);
  const balance = useChainStore((s) => s.balance);
  const encryptionKey = useEncryptionKey(account);

  const [listing, setListing] = useState<Listing | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [buyStatus, setBuyStatus] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);

  useEffect(() => {
    if (!id) { setPageState('not-found'); return; }
    const listingId = BigInt(id);

    fetchListing(listingId)
      .then(async (l) => {
        if (!l) { setPageState('not-found'); return; }
        setListing(l);
        const isCreator = account === l.creator;
        // Creator OR buyer — both render via VideoPlayer (Phase 2 unifies them).
        if (isCreator) { setPageState('purchased'); return; }
        if (!account) { setPageState('unpurchased'); return; }
        const purchased = await hasPurchased(account, listingId);
        setPageState(purchased ? 'purchased' : 'unpurchased');
      })
      .catch(() => setPageState('not-found'));
  }, [id, account]);

  if (pageState === 'loading') {
    return (
      <div className="animate-pulse flex flex-col gap-4">
        <div className="h-4 w-24 rounded bg-white/[0.06]" />
        <div className="w-full aspect-video rounded-xl bg-surface-800" />
      </div>
    );
  }

  if (pageState === 'not-found' || !listing) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-text-secondary">Listing not found.</p>
        <Link to="/" className="text-polka-400 hover:text-polka-300 text-sm">← Browse</Link>
      </div>
    );
  }

  const isCreator = account === listing.creator;
  const canAfford = balance >= listing.price;

  async function handleBuy() {
    if (!listing || !account || !encryptionKey.ready || !encryptionKey.publicKey) return;
    setBuyError(null);
    setBuyStatus('Waiting for signature…');
    try {
      await submitPurchaseMaybeBatched(listing.id, account, encryptionKey.publicKey);
      setBuyStatus(null);
      setPageState('purchased');
    } catch (e) {
      setBuyStatus(null);
      setBuyError(String(e));
    }
  }

  function handleCopyAddress() {
    navigator.clipboard.writeText(listing!.creator);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleCopyId() {
    navigator.clipboard.writeText(listing!.id.toString());
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  }

  const showPlayer = pageState === 'purchased' && account && encryptionKey.ready
    && encryptionKey.publicKey && encryptionKey.privateKey;

  return (
    <div>
      <Link to="/" className="text-sm text-text-muted hover:text-text-primary mb-4 inline-block">
        ← Browse
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1">
          {showPlayer ? (
            <VideoPlayer
              contentCid={listing.contentCid}
              contentHash={listing.contentHash}
              listingId={listing.id}
              currentAccount={account!}
              viewerPublicKey={encryptionKey.publicKey!}
              viewerPrivateKey={encryptionKey.privateKey!}
              plaintextKey={getCachedKey(listing.id)}
            />
          ) : (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-surface-800">
              <img src={listing.thumbnailUrl} alt={listing.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="text-white/70 text-sm font-medium tracking-wide uppercase">🔒 Preview</span>
              </div>
            </div>
          )}
        </div>

        <div className="lg:w-72 flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-text-primary">{listing.title}</h1>

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-mono">
              {isCreator ? truncateAddress(listing.creator) : `Uploaded by ${truncateAddress(listing.creator)}`}
            </span>
            <button onClick={handleCopyAddress} className="text-xs text-polka-400 hover:text-polka-300">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <div data-testid="listing-id" className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-mono">ID: {listing.id.toString()}</span>
            <button onClick={handleCopyId} className="text-xs text-polka-400 hover:text-polka-300">
              {idCopied ? 'Copied!' : 'Copy ID'}
            </button>
          </div>

          <p className="text-lg font-semibold text-polka-300">{formatDot(listing.price)}</p>

          {pageState === 'purchased' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-accent-green font-medium">
                {isCreator ? 'Your listing' : '✓ Purchased'}
              </span>
            </div>
          )}

          {pageState === 'unpurchased' && !isCreator && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleBuy}
                disabled={!canAfford || !!buyStatus || !encryptionKey.ready}
                className="w-full py-2.5 rounded-lg bg-polka-500 hover:bg-polka-400 text-white text-sm
                           font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {buyStatus ?? (encryptionKey.ready ? `Buy for ${formatDot(listing.price)}` : 'Preparing encryption key…')}
              </button>
              <p className="text-xs text-text-muted">
                Balance: {formatDot(balance)}
              </p>
              {!canAfford && (
                <p className="text-xs text-accent-red">
                  Not enough DOT to purchase this listing.
                </p>
              )}
              {buyError && <p className="text-xs text-accent-red">{buyError}</p>}
            </div>
          )}

          <p className="text-sm text-text-secondary whitespace-pre-wrap">{listing.description}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run: `cd web && npm test`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ListingDetailPage.tsx
git commit -m "feat(web): ListingDetailPage — Phase-2 state-3/4 flow + batched purchase"
```

---

## Task 11 — Regenerate PAPI descriptors + lint + typecheck clean pass

**Files:**
- Modify: `web/.papi/descriptors/*` (regenerated, committed verbatim if anything changes)

**Why:** Belt-and-braces sweep before E2E. If P2a tightened the metadata and the existing `d1e2aef` covers it, this is a no-op. Still worth running so the plan doesn't assume a stale descriptor.

- [ ] **Step 1: Regenerate descriptors**

```bash
cd web && npm run codegen
```

- [ ] **Step 2: Confirm no unexpected drift**

```bash
git status web/.papi/descriptors
```

Expected: either no changes, or churn limited to types exposed by the pallet changes in P2a.

- [ ] **Step 3: Full typecheck + lint + tests**

```bash
cd web && npx tsc -b --noEmit && npm run lint && npm test
```

Expected: all green.

- [ ] **Step 4: Commit if descriptors changed**

```bash
# Only if step 2 showed diffs:
git add web/.papi/descriptors
git commit -m "chore(web): regenerate PAPI descriptors for P2c"
```

---

## Task 12 — E2E verification on Zombienet with content-unlock-service daemon

**Files:**
- Modify (maybe): `web/scripts/smoke-test-ppview-encryption.ts` — if it needs extension
- No code under `web/src/*` in this task; this is pure verification.

**Why:** Frontend unit tests cover crypto and state transitions, but the Phase-2 promise — "upload, buy, and the buyer's browser decrypts" — only holds when the pallet, the daemon, and the frontend agree on wire formats. Run the full loop once end-to-end.

- [ ] **Step 1: Launch the full stack**

In three separate terminals (the user will run these — per session rules, do not launch sudo/long-running services yourself):

```bash
# Terminal 1 — Zombienet relay+parachain
./scripts/launch-zombienet.sh   # or the equivalent script invoked by P2a Task 10

# Terminal 2 — content-unlock-service daemon
./offchain/content-unlock-service/start-content-unlock-service.sh

# Terminal 3 — frontend dev server
cd web && npm run dev
```

- [ ] **Step 2: Exercise the creator flow (browser)**

1. Open `http://localhost:5173` (or the port Vite reports).
2. Confirm the top-bar account pill shows Bob (dev user; see `useAccount.ts` `DEV_USER_INDEX`).
3. Navigate to `/create`. Pick a small `.mp4` (< 1.9 MiB).
4. Pick a thumbnail; fill title, description, price.
5. Click `Create listing`.

Expected checklist progression (observe in the UI):
- Generating content-lock-key → done
- Encrypting content → done
- Computing content hash → done
- Uploading thumbnail → progress bar → done
- Uploading encrypted content → progress bar → done
- Sealing content-lock-key to SVC_PUB → done
- Submitting create_listing → done

After the submit lands, the browser redirects to `/listing/<new_id>`. Because this is a fresh session, it's also the first-ever listing for Bob — confirm by checking the phone host (or Triangle simulator) showed a single signature prompt that covered **both** `register_encryption_key` and `create_listing`.

Playback: the `Your listing` badge appears and the video plays immediately (creator fast-path via `contentLockKeyCache`).

- [ ] **Step 3: Observe the daemon**

Daemon stdout should include, within a few seconds of the block finalizing:

```
… listing_id=N target=<Bob SS58> kind=Creator … grant_access finalized
```

Confirm `WrappedKeys[(Bob, N)]` exists on-chain:

```bash
cd web && npx tsx scripts/smoke-test-ppview-encryption.ts
```

(That script now runs against an existing chain and will stop at the reconciliation check; use it as a query harness, ignore its setup steps for this check. Alternatively, run a one-line `node` / `polkadot-js-app` read of `ContentRegistry.WrappedKeys(<Bob>, <N>)`.)

- [ ] **Step 4: Exercise the buyer flow (second account)**

Restart the dev server with `DEV_USER_INDEX` flipped to Charlie (`export PPVIEW_DEV_USER=2` — if we have that env var — otherwise temporarily edit `useAccount.ts:59` to `DEV_USER_INDEX = 2`; revert before committing), reload the browser.

1. Navigate to `/listing/<N>`. The page should render state 1 (thumbnail + Preview lock overlay + Buy button).
2. Click `Buy for X DOT`.
3. Browser flips to `Preparing your content…` (state 3) for a few seconds.
4. Daemon logs `kind=Buyer … grant_access finalized`.
5. Browser transitions to state 4: video plays with `✓ Content verified`.

- [ ] **Step 5: Negative case — integrity failure**

Revert `DEV_USER_INDEX` to Bob; don't commit the dev-user tweak.

Optional but recommended: manually tamper by editing one byte of the served ciphertext (via a Service Worker or a mitm proxy) OR flip one byte of `content_hash` in the listing struct pre-submit (requires a short code modification in a scratch branch). Expected UI: state 4 transitions to `⚠ Content failed integrity check`. Skip if time-boxed.

- [ ] **Step 6: Report the outcome**

If every path above behaves as expected, this task is ready to tick. If any step diverges, open a short bug note and pause the plan instead of ticking.

This task has no new commit; ticking the progress box is the only artifact.

---

## Task 13 — Dev-server smoke + progress tick

**Files:** None — validation task.

- [ ] **Step 1: Final dev-server smoke**

```bash
cd web && npm run build
```

Expected: clean production build, no TypeScript errors.

- [ ] **Step 2: Run the full test suite one more time**

```bash
cd web && npm test && npm run lint
```

Expected: all green.

- [ ] **Step 3: Surface the validation prompt for the user**

Per CLAUDE.md: report the task, wait for the user to say "tick it". Suggested message: `P2c done — Phase 2 encrypted upload/buy/play works end-to-end. Please smoke it once more in browser and I'll flip the progress boxes.`

---

## Progress tracking

Append to `docs/progress.md` under `### P2c — Frontend encryption flow`:

```markdown
Plan: [`docs/plans/P2c-frontend-encryption.md`](./plans/P2c-frontend-encryption.md)

- [ ] Task 1: sealed-box utility + sodium init helper
- [ ] Task 2: content-secretbox encryption utility
- [ ] Task 3: x25519 keypair utility
- [ ] Task 4: session-storage adapter (host vs dev)
- [ ] Task 5: useEncryptionKey hook
- [ ] Task 6: in-memory content-lock-key cache
- [ ] Task 7: useContentRegistry Phase-2 reads + batched writes + 80-byte locked key
- [ ] Task 8: CreatePage — encrypt + seal + batched submit + CLK cache
- [ ] Task 9: VideoPlayer — decrypt via WrappedKeys or cached CLK
- [ ] Task 10: ListingDetailPage — Phase-2 states + batched purchase
- [ ] Task 11: PAPI descriptor regen + lint + typecheck sweep
- [ ] Task 12: Zombienet E2E with content-unlock-service daemon
- [ ] Task 13: Dev-server build smoke
```

Remember: per CLAUDE.md, appending to `docs/progress.md` needs explicit per-commit approval from the user.
