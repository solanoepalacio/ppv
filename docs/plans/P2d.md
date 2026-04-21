# P2d — Signer manager swap (Talisman everywhere) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bespoke dev-only user-signer plumbing in `useParachainProvider.ts` with `@polkadot-apps/signer`'s `SignerManager`, so the user signs every parachain extrinsic (and Bulletin `store()`) with a browser-extension wallet (Talisman / Polkadot.js / SubWallet) in both dev and prod. Alice stays exactly as today: an hdkd-derived `PolkadotSigner` used only to authorize the user's Bulletin account.

**Architecture:** One module-level `SignerManager` singleton lives in a new `signerManager.ts`. It auto-detects the environment (standalone browser → extension provider; container → host first, extension fallback), persists the selected address in localStorage, and bridges state to the existing zustand `useChainStore` for downstream consumers. A tiny `<WalletPicker />` header component subscribes via `useSyncExternalStore` and drives `connect()` / `selectAccount()`. `useParachainProvider.ts` keeps transport selection (`sandboxProvider.isCorrectEnvironment()` → `createPapiProvider` vs `getWsProvider(DEV_WS)`) and balance subscription, but stops owning signer state. `useAccount.ts` narrows to Alice-only. Call sites in `useContentRegistry.ts` and `useBulletinUpload.ts` change only their import paths. The Bulletin user-client cache in `useBulletinUpload.ts` gains address-keyed invalidation so account switching doesn't bind old signers.

**Tech Stack:** `@polkadot-apps/signer` 1.1 (already installed), `polkadot-api` 1.23, `@novasamatech/product-sdk` 0.6+ (peer, already present), `@polkadot-labs/hdkd` (Alice only), React 18 `useSyncExternalStore`, zustand 5, Vitest + `@testing-library/react`.

**Scope carve-outs (not in this plan):**

- **Funding.** A user's Talisman account against Zombienet starts at zero balance and cannot pay fees. The user handles funding out-of-band (polkadot-js apps, a script, whatever) for this refactor.
- **Host-mode account flow.** `@polkadot-apps/signer`'s `HostProvider` covers it via auto-detect, but we do not exercise it in this plan. The signer-swap lands with extension-only user paths verified on Zombienet.
- **Ring VRF / product accounts / aliases.** Host-exclusive features; out of scope.
- **Wallet chooser UI.** Auto-detect picks the extension. If a user has multiple extensions installed we don't present a chooser.
- **Funding button / sudo tooling in-app.** Explicitly rejected earlier in brainstorming.

**Prerequisites:** P1b complete (the current two-signer plumbing is what this plan rewrites). `@polkadot-apps/signer` v1.1.0 already installed at `web/node_modules/@polkadot-apps/signer`.

---

## File Structure

**Created:**

- `web/src/hooks/signerManager.ts` — `SignerManager` singleton, `getUserSigner()`, `getUserAddress()`, `useSignerState()`, silent-reconnect-on-load, zustand bridge.
- `web/src/hooks/signerManager.test.ts` — contract tests with stub provider factory.
- `web/src/components/WalletPicker.tsx` — four-state picker (disconnected / connecting / zero-accounts / selecting).
- `web/src/components/WalletPicker.test.tsx` — render tests against stub-backed manager.

**Modified:**

- `web/src/hooks/useAccount.ts` — strip `devAccounts`, `DEV_USER_INDEX`, `aliceAccount`, `getDevKeypair`. Keep Alice derivation + `getAliceSigner()`.
- `web/src/hooks/useAccount.test.ts` — drop the removed-export tests.
- `web/src/hooks/useParachainProvider.ts` — remove all user-signer state (`_userSigner`, `_userAddress`, subscribers, `getUserSigner`, `getUserAddress`, `getAliceSigner` re-export, `subscribeUserAccount`, `setUserAccount`). Keep PAPI client + transport selection. Split balance subscription into its own effect keyed on `chainStore.account`.
- `web/src/hooks/useContentRegistry.ts` — change `getUserSigner` import to `./signerManager`.
- `web/src/hooks/useBulletinUpload.ts` — change imports: `getAliceSigner` from `./useAccount`, `getUserSigner`/`getUserAddress` from `./signerManager`. Replace `_userClient: AsyncBulletinClient | null` cache with address-keyed invalidation.
- `web/src/hooks/useBulletinUpload.test.ts` — add a test for user-client invalidation on address change.
- `web/src/App.tsx` — mount `<WalletPicker />` in the top-right slot that currently renders the truncated-address pill + "Pair your Polkadot App" copy.
- `docs/design/spec.md` — §5.1 + §6 updates: Talisman-everywhere user signer; drop the dev-only Bob pin rule; Alice remains dev-only for Bulletin authorize.

**Untouched (reused):**

- `web/src/store/chainStore.ts` — still holds `account / balance / connected`; signerManager becomes the single writer for `account`.
- `web/src/hooks/useChain.ts` — unrelated singleton.
- Every page (`BrowsePage`, `ListingDetailPage`, `CreatePage`, `PurchasesPage`) — consumes `useChainStore.account`; no change.

---

## Task 1 — Smoke-test `@polkadot-apps/signer` import path

**Files:**
- Create: `web/src/hooks/signerManager.test.ts` (stub file, replaced in Task 3)

Smoke check that the library imports cleanly under Vite + Vitest in this project's TS config. No implementation yet.

- [ ] **Step 1: Write a smoke test that constructs the manager**

```ts
// web/src/hooks/signerManager.test.ts
import { describe, test, expect } from 'vitest';
import { SignerManager } from '@polkadot-apps/signer';

describe('@polkadot-apps/signer smoke', () => {
  test('SignerManager constructs with defaults', () => {
    const manager = new SignerManager({ dappName: 'ppview', ss58Prefix: 42 });
    const state = manager.getState();
    expect(state.status).toBe('disconnected');
    expect(state.accounts).toEqual([]);
    expect(state.selectedAccount).toBeNull();
    manager.destroy();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
cd web && npm test -- signerManager
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/signerManager.test.ts
git commit -m "P2d: smoke test @polkadot-apps/signer import"
```

---

## Task 2 — Narrow `useAccount.ts` to Alice-only (TDD)

**Files:**
- Modify: `web/src/hooks/useAccount.ts`
- Modify: `web/src/hooks/useAccount.test.ts`

Alice stays. Everything dev-user goes away: `devAccounts` array, `DEV_USER_INDEX`, `aliceAccount` alias, `getDevKeypair`. The signer type `DevAccount` is dropped. `getAliceSigner()` keeps its exact signature.

- [ ] **Step 1: Rewrite `useAccount.test.ts` to the new surface**

```ts
// web/src/hooks/useAccount.test.ts
import { describe, test, expect } from 'vitest';
import { getAliceSigner } from './useAccount';
import { ss58Address } from '@polkadot-labs/hdkd-helpers';

describe('useAccount', () => {
  test('getAliceSigner returns a PolkadotSigner for //Alice', () => {
    const signer = getAliceSigner();
    // The //Alice sr25519 public key (well-known):
    //   0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
    const aliceAddress = ss58Address(signer.publicKey, 42);
    expect(aliceAddress).toBe('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
  });

  test('getAliceSigner returns a stable instance across calls', () => {
    expect(getAliceSigner()).toBe(getAliceSigner());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && npm test -- useAccount
```

Expected: FAIL — the existing test file imports `devAccounts`, `aliceAccount`, `DEV_USER_INDEX`, which will still exist until Step 3. Actually the existing tests pass; our new test replaces them. If tests pass at this step, that's fine — we're just ensuring the new contract holds.

- [ ] **Step 3: Rewrite `useAccount.ts` to the narrowed surface**

```ts
// web/src/hooks/useAccount.ts
import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
} from '@polkadot-labs/hdkd-helpers';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { type PolkadotSigner } from 'polkadot-api';

const entropy = mnemonicToEntropy(DEV_PHRASE);
const miniSecret = entropyToMiniSecret(entropy);
const derive = sr25519CreateDerive(miniSecret);
const aliceKeypair = derive('//Alice');

const _aliceSigner: PolkadotSigner = getPolkadotSigner(
  aliceKeypair.publicKey,
  'Sr25519',
  aliceKeypair.sign,
);

/**
 * Alice's PAPI signer. Used ONLY for Bulletin `authorize_account` /
 * `authorize_preimage`. Never use for parachain extrinsics — the user
 * signs those via the extension wallet (see `signerManager.ts`).
 *
 * Alice's keys come from the well-known DEV_PHRASE and are safe only
 * against the local Zombienet dev chain.
 */
export function getAliceSigner(): PolkadotSigner {
  return _aliceSigner;
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npm test -- useAccount
```

Expected: PASS (both new tests).

- [ ] **Step 5: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: FAIL — `useParachainProvider.ts` imports `devAccounts`, `DEV_USER_INDEX`, and re-exports `getAliceSigner` from here. That's a known broken state resolved in Task 5. Capture the error set; it should only mention `useParachainProvider.ts`.

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useAccount.ts web/src/hooks/useAccount.test.ts
git commit -m "P2d: narrow useAccount to Alice-only (TDD)"
```

Note: the tree is intentionally not typechecking after this commit. Task 5 fixes it.

---

## Task 3 — `signerManager.ts` — module singleton + getters + React hook (TDD)

**Files:**
- Replace: `web/src/hooks/signerManager.test.ts` (full content below)
- Create: `web/src/hooks/signerManager.ts`

The module constructs one `SignerManager`, exposes `getUserSigner()` / `getUserAddress()` / `useSignerState()`, and installs a subscriber that pushes `state.selectedAccount?.address` into `useChainStore.setAccount`. The silent `connect()` on module load is added in Task 4 so we can unit-test without touching `window.injectedWeb3`.

- [ ] **Step 1: Replace `signerManager.test.ts` with the contract tests**

The library's `SignerManagerOptions.createProvider` factory lets us inject a stub provider so tests don't touch real extensions. Stub shape is derived from `dist/providers/types.d.ts`.

```ts
// web/src/hooks/signerManager.test.ts
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SignerManager } from '@polkadot-apps/signer';
import type { PolkadotSigner } from 'polkadot-api';
import type { SignerAccount } from '@polkadot-apps/signer';

// Shared mutable state that the stub provider reads on `connect()`.
// `vi.hoisted` pushes the initializer above the `vi.mock` factory so the
// factory can close over it without referencing hoisted imports.
const stubState = vi.hoisted(() => ({
  accounts: [] as unknown[],
}));

vi.mock('./signerManagerFactory', async () => {
  const { SignerManager } = await import('@polkadot-apps/signer');
  return {
    createSignerManager: () => new SignerManager({
      dappName: 'ppview-test',
      ss58Prefix: 42,
      persistence: null, // disable localStorage in tests
      createProvider: () => ({
        type: 'extension' as const,
        connect: async () => ({ ok: true, value: stubState.accounts as SignerAccount[] }),
        disconnect: () => {},
        onStatusChange: () => () => {},
        onAccountsChange: () => () => {},
      }),
    }),
  };
});

function makeStubAccount(address: string, name: string): SignerAccount {
  const pk = new Uint8Array(32);
  return {
    address,
    h160Address: '0x0000000000000000000000000000000000000000',
    publicKey: pk,
    name,
    source: 'extension',
    getSigner: () => ({
      publicKey: pk,
      signTx: vi.fn(),
      signBytes: vi.fn(),
    } as unknown as PolkadotSigner),
  };
}

describe('signerManager', () => {
  beforeEach(() => {
    stubState.accounts = [];
    vi.resetModules();
  });

  test('getUserSigner throws when no account selected', async () => {
    const { getUserSigner } = await import('./signerManager');
    expect(() => getUserSigner()).toThrow(/No user signer/);
  });

  test('getUserAddress returns null when disconnected', async () => {
    const { getUserAddress } = await import('./signerManager');
    expect(getUserAddress()).toBeNull();
  });

  test('selecting an account exposes its PolkadotSigner via getUserSigner', async () => {
    const acct = makeStubAccount('5Grw...', 'Demo');
    stubState.accounts = [acct];
    const { manager, getUserSigner, getUserAddress } = await import('./signerManager');
    const result = await manager.connect('extension');
    expect(result.ok).toBe(true);
    manager.selectAccount(acct.address);
    expect(getUserAddress()).toBe(acct.address);
    expect(getUserSigner()).toBe(acct.getSigner());
  });

  test('bridge pushes selectedAccount address into chainStore', async () => {
    const acct = makeStubAccount('5Grw...', 'Demo');
    stubState.accounts = [acct];
    const { manager } = await import('./signerManager');
    const { useChainStore } = await import('../store/chainStore');
    await manager.connect('extension');
    manager.selectAccount(acct.address);
    expect(useChainStore.getState().account).toBe(acct.address);
  });

  test('useSignerState re-renders on selection change', async () => {
    const acct = makeStubAccount('5Grw...', 'Demo');
    stubState.accounts = [acct];
    const { manager, useSignerState } = await import('./signerManager');
    const { result } = renderHook(() => useSignerState());
    expect(result.current.status).toBe('disconnected');
    await act(async () => {
      await manager.connect('extension');
      manager.selectAccount(acct.address);
    });
    expect(result.current.selectedAccount?.address).toBe(acct.address);
  });
});
```

- [ ] **Step 2: Create `signerManagerFactory.ts` (indirection for test override)**

```ts
// web/src/hooks/signerManagerFactory.ts
import { SignerManager } from '@polkadot-apps/signer';

export function createSignerManager(): SignerManager {
  return new SignerManager({
    dappName: 'ppview',
    ss58Prefix: 42,
    // persistence defaults to localStorage in browser, no-op in node
  });
}
```

- [ ] **Step 3: Create `signerManager.ts`**

```ts
// web/src/hooks/signerManager.ts
import { useSyncExternalStore } from 'react';
import type { PolkadotSigner } from 'polkadot-api';
import type { SignerState } from '@polkadot-apps/signer';
import { useChainStore } from '../store/chainStore';
import { createSignerManager } from './signerManagerFactory';

export const manager = createSignerManager();

// Bridge selected-account address into zustand for downstream consumers.
manager.subscribe((state: SignerState) => {
  const addr = state.selectedAccount?.address ?? null;
  if (useChainStore.getState().account !== addr) {
    useChainStore.getState().setAccount(addr);
  }
});

export function getUserSigner(): PolkadotSigner {
  const signer = manager.getSigner();
  if (!signer) throw new Error('No user signer — no account selected');
  return signer;
}

export function getUserAddress(): string | null {
  return manager.getState().selectedAccount?.address ?? null;
}

// Stable references required by useSyncExternalStore.
const subscribeListener = (cb: () => void) => manager.subscribe(() => cb());
const getSnapshot = (): SignerState => manager.getState();

export function useSignerState(): SignerState {
  return useSyncExternalStore(subscribeListener, getSnapshot);
}
```

- [ ] **Step 4: Run tests**

```bash
cd web && npm test -- signerManager
```

Expected: PASS on all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/signerManager.ts web/src/hooks/signerManagerFactory.ts web/src/hooks/signerManager.test.ts
git commit -m "P2d: signerManager singleton + chainStore bridge + useSignerState (TDD)"
```

---

## Task 4 — Silent reconnect on module load

**Files:**
- Modify: `web/src/hooks/signerManager.ts`
- Modify: `web/src/hooks/signerManager.test.ts`

On page reload with a persisted selection, Talisman already remembers the dApp authorization grant, so `manager.connect()` completes with no popup and restores the prior account. On a fresh visit with no persistence, `connect()` fails inside the extensionTimeout and leaves the manager in `disconnected` — the picker then shows a Connect button.

- [ ] **Step 1: Write the test**

Append to `web/src/hooks/signerManager.test.ts`:

```ts
test('auto-connects on module load when connect() succeeds', async () => {
  const acct = makeStubAccount('5Grw...', 'Demo');
  stubState.accounts = [acct];
  // Fresh import triggers the silent connect.
  const { manager } = await import('./signerManager');
  // Give the microtask queue one tick.
  await new Promise(r => setTimeout(r, 0));
  expect(manager.getState().status).toBe('connected');
});

test('remains disconnected when silent connect fails', async () => {
  vi.resetModules();
  vi.doMock('./signerManagerFactory', async () => {
    const { SignerManager } = await import('@polkadot-apps/signer');
    return {
      createSignerManager: () => new SignerManager({
        dappName: 'ppview-test',
        ss58Prefix: 42,
        persistence: null,
        createProvider: () => ({
          type: 'extension' as const,
          connect: async () => ({ ok: false, error: new Error('no extension') }),
          disconnect: () => {},
          onStatusChange: () => () => {},
          onAccountsChange: () => () => {},
        }),
      }),
    };
  });
  const { manager } = await import('./signerManager');
  await new Promise(r => setTimeout(r, 0));
  expect(manager.getState().status).toBe('disconnected');
  vi.doUnmock('./signerManagerFactory');
});
```

- [ ] **Step 2: Add the silent connect to `signerManager.ts`**

Append at the bottom of `signerManager.ts` (after the `useSignerState` export):

```ts
// Kick off a silent reconnect. Talisman remembers the dApp authorization
// across reloads, so this triggers no popup when a session was previously
// established; on a first visit it fails quickly and leaves the manager
// in 'disconnected' for the WalletPicker to render a Connect button.
//
// Top-level await is avoided for compatibility with the Vite/SWC pipeline.
void manager.connect().catch(() => {
  // Swallow — UI surfaces the disconnected state via useSignerState.
});
```

- [ ] **Step 3: Run tests**

```bash
cd web && npm test -- signerManager
```

Expected: PASS on all 7 tests.

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/signerManager.ts web/src/hooks/signerManager.test.ts
git commit -m "P2d: silent reconnect on signerManager load (TDD)"
```

---

## Task 5 — Rewrite `useParachainProvider.ts` — transport + balance only (TDD)

**Files:**
- Modify: `web/src/hooks/useParachainProvider.ts`
- Create: `web/src/hooks/useParachainProvider.test.ts` (if absent; add to existing if present)

Drop all user-signer state (`_userSigner`, `_userAddress`, subscribers, `getUserSigner`, `getUserAddress`, `getAliceSigner`, `subscribeUserAccount`, `setUserAccount`). Keep `_parachainClient` + `_parachainApi` + `getParachainApi()`. Transport selection — `sandboxProvider.isCorrectEnvironment()` → `createPapiProvider(PPVIEW_GENESIS)` vs `getWsProvider(DEV_WS)` — stays. Balance subscription moves into its own effect keyed on `chainStore.account`.

- [ ] **Step 1: Write the test**

```ts
// web/src/hooks/useParachainProvider.test.ts
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const watchValueMock = vi.fn();
const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();

vi.mock('polkadot-api', async (orig) => {
  const actual = await orig<typeof import('polkadot-api')>();
  return {
    ...actual,
    createClient: () => ({
      getTypedApi: () => ({
        query: { System: { Account: { watchValue: watchValueMock } } },
      }),
    }),
  };
});

vi.mock('@novasamatech/product-sdk', () => ({
  sandboxProvider: { isCorrectEnvironment: () => false },
  sandboxTransport: {},
  createPapiProvider: vi.fn(),
  createAccountsProvider: vi.fn(),
  hostApi: {},
}));

describe('useParachainProvider', () => {
  beforeEach(() => {
    watchValueMock.mockReset();
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    watchValueMock.mockReturnValue({ subscribe: subscribeMock });
    subscribeMock.mockReturnValue({ unsubscribe: unsubscribeMock });
  });

  test('does not subscribe balance while account is null', async () => {
    const { useChainStore } = await import('../store/chainStore');
    useChainStore.setState({ account: null, connected: false });
    const { useParachainProvider } = await import('./useParachainProvider');
    renderHook(() => useParachainProvider());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(watchValueMock).not.toHaveBeenCalled();
  });

  test('subscribes balance when account becomes non-null', async () => {
    const { useChainStore } = await import('../store/chainStore');
    useChainStore.setState({ account: null, connected: false });
    const { useParachainProvider } = await import('./useParachainProvider');
    renderHook(() => useParachainProvider());
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
      useChainStore.getState().setAccount('5Grw...');
    });
    expect(watchValueMock).toHaveBeenCalledWith('5Grw...');
    expect(subscribeMock).toHaveBeenCalled();
  });

  test('re-subscribes balance when account changes', async () => {
    const { useChainStore } = await import('../store/chainStore');
    useChainStore.setState({ account: '5Grw...', connected: false });
    const { useParachainProvider } = await import('./useParachainProvider');
    renderHook(() => useParachainProvider());
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
      useChainStore.getState().setAccount('5HBu...');
    });
    expect(unsubscribeMock).toHaveBeenCalled();
    expect(watchValueMock).toHaveBeenCalledWith('5HBu...');
  });
});
```

- [ ] **Step 2: Rewrite `useParachainProvider.ts`**

```ts
// web/src/hooks/useParachainProvider.ts
import { createClient, type PolkadotClient, type TypedApi } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import {
  sandboxProvider,
  createPapiProvider,
  hostApi,
} from '@novasamatech/product-sdk';
import { enumValue } from '@novasamatech/host-api';
import { ppview } from '@polkadot-api/descriptors';
import { useEffect } from 'react';
import { useChainStore } from '../store/chainStore';

const PPVIEW_GENESIS = '0x4545454545454545454545454545454545454545454545454545454545454545';
const DEV_WS = 'ws://127.0.0.1:9944';

type ParachainApi = TypedApi<typeof ppview>;

let _parachainClient: PolkadotClient | null = null;
let _parachainApi: ParachainApi | null = null;
let _initPromise: Promise<void> | null = null;

export function getParachainApi(): ParachainApi {
  if (!_parachainApi) throw new Error('Parachain provider not initialized');
  return _parachainApi;
}

async function initClient(): Promise<void> {
  if (_parachainClient) return;
  const inHost = sandboxProvider.isCorrectEnvironment();
  if (inHost) {
    await hostApi
      .permission(enumValue('v1', { tag: 'TransactionSubmit', value: undefined }))
      .match(
        () => {},
        (err: unknown) => console.warn('Transaction permission denied:', err),
      );
    _parachainClient = createClient(createPapiProvider(PPVIEW_GENESIS));
  } else {
    _parachainClient = createClient(withPolkadotSdkCompat(getWsProvider(DEV_WS)));
  }
  _parachainApi = _parachainClient.getTypedApi(ppview);
}

/**
 * Mount once in App. Initializes the PAPI client (transport depends on
 * host vs standalone) and subscribes to balance updates whenever the
 * selected account changes. The selected account is driven by the
 * WalletPicker via signerManager → chainStore.
 */
export function useParachainProvider() {
  const account = useChainStore((s) => s.account);
  const setBalance = useChainStore((s) => s.setBalance);
  const setConnected = useChainStore((s) => s.setConnected);

  // Init once.
  useEffect(() => {
    if (!_initPromise) _initPromise = initClient().then(() => { setConnected(true); });
    _initPromise.catch((err) => console.error('Parachain client init failed:', err));
  }, [setConnected]);

  // Resubscribe balance on account change.
  useEffect(() => {
    if (!account || !_parachainApi) return;
    const sub = _parachainApi.query.System.Account.watchValue(account).subscribe({
      next: (info: { data: { free: bigint } }) => setBalance(info.data.free),
      error: (err: unknown) => console.error('Balance subscription error:', err),
    });
    return () => sub.unsubscribe();
  }, [account, setBalance]);
}
```

- [ ] **Step 3: Run tests**

```bash
cd web && npm test -- useParachainProvider
```

Expected: PASS on all 3 tests.

- [ ] **Step 4: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: FAIL — `useContentRegistry.ts` and `useBulletinUpload.ts` still import `getUserSigner` / `getAliceSigner` / `getUserAddress` from `./useParachainProvider`. Resolved in Task 6.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useParachainProvider.ts web/src/hooks/useParachainProvider.test.ts
git commit -m "P2d: useParachainProvider — transport + balance only; no signer state (TDD)"
```

Tree still doesn't typecheck; Task 6 fixes it.

---

## Task 6 — Update call sites in `useContentRegistry.ts` and `useBulletinUpload.ts`

**Files:**
- Modify: `web/src/hooks/useContentRegistry.ts`
- Modify: `web/src/hooks/useBulletinUpload.ts`

Pure import-path changes. No behaviour change yet (client caching in `useBulletinUpload.ts` stays broken across account switch; fixed in Task 7).

- [ ] **Step 1: Change imports in `useContentRegistry.ts`**

Find the line at `web/src/hooks/useContentRegistry.ts:2`:

```ts
import { getParachainApi, getUserSigner } from './useParachainProvider';
```

Replace with:

```ts
import { getParachainApi } from './useParachainProvider';
import { getUserSigner } from './signerManager';
```

- [ ] **Step 2: Change imports in `useBulletinUpload.ts`**

Find the line at `web/src/hooks/useBulletinUpload.ts:11`:

```ts
import { getAliceSigner, getUserSigner, getUserAddress } from "./useParachainProvider";
```

Replace with:

```ts
import { getAliceSigner } from "./useAccount";
import { getUserSigner, getUserAddress } from "./signerManager";
```

- [ ] **Step 3: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run the full test suite**

```bash
cd web && npm test
```

Expected: PASS. `useBulletinUpload.test.ts` may still pass because it mocks `useParachainProvider`; if it breaks because the mocked surface no longer includes those exports, update the mock — delete the `getAliceSigner`/`getUserSigner`/`getUserAddress` keys from the `useParachainProvider` mock and add mocks for `./useAccount` and `./signerManager`:

```ts
// in useBulletinUpload.test.ts — replace mock block
vi.mock('./useParachainProvider', () => ({
  getParachainApi: vi.fn(),
}));
vi.mock('./useAccount', () => ({
  getAliceSigner: vi.fn(() => ({ /* fake signer */ })),
}));
vi.mock('./signerManager', () => ({
  getUserSigner: vi.fn(() => ({ /* fake signer */ })),
  getUserAddress: vi.fn(() => '5HBu...'),
}));
```

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useContentRegistry.ts web/src/hooks/useBulletinUpload.ts web/src/hooks/useBulletinUpload.test.ts
git commit -m "P2d: update call sites to import signers from signerManager + useAccount"
```

---

## Task 7 — Invalidate Bulletin user-client on address change (TDD)

**Files:**
- Modify: `web/src/hooks/useBulletinUpload.ts`
- Modify: `web/src/hooks/useBulletinUpload.test.ts`

The current `_userClient` cache in `useBulletinUpload.ts` (line 27) binds the signer permanently on first access. When a user switches accounts via the new picker, `_userClient` still holds the old account's signer. Replace the cache with an address-keyed record so it rebuilds when the selected address changes. Alice's cache stays single-instance.

- [ ] **Step 1: Write the test**

Append to `web/src/hooks/useBulletinUpload.test.ts`:

```ts
describe('user client address invalidation', () => {
  test('rebuilds user client when selected address changes', async () => {
    const { _resetUserClientForTests, getUserClientForTests } = await import('./useBulletinUpload');
    // First address
    const signerA = { publicKey: new Uint8Array([1]) };
    const getUserSigner = (await import('./signerManager')).getUserSigner as ReturnType<typeof vi.fn>;
    const getUserAddress = (await import('./signerManager')).getUserAddress as ReturnType<typeof vi.fn>;
    getUserSigner.mockReturnValue(signerA);
    getUserAddress.mockReturnValue('5AAAA');
    const first = getUserClientForTests();
    const firstAgain = getUserClientForTests();
    expect(first).toBe(firstAgain); // same address → cached

    // Address changes → rebuild
    const signerB = { publicKey: new Uint8Array([2]) };
    getUserSigner.mockReturnValue(signerB);
    getUserAddress.mockReturnValue('5BBBB');
    const second = getUserClientForTests();
    expect(second).not.toBe(first);

    _resetUserClientForTests();
  });
});
```

- [ ] **Step 2: Replace the `_userClient` cache in `useBulletinUpload.ts`**

Find the cache block (around lines 26–50 of `useBulletinUpload.ts`):

```ts
let _userClient: AsyncBulletinClient | null = null;
// ...
function getUserClient(): AsyncBulletinClient {
  if (!_userClient) _userClient = buildClient(getUserSigner());
  return _userClient;
}
```

Replace with:

```ts
let _userClient: { address: string; client: AsyncBulletinClient } | null = null;

function getUserClient(): AsyncBulletinClient {
  const address = getUserAddress();
  if (!address) {
    throw new Error('No user account selected — connect a wallet before uploading');
  }
  if (!_userClient || _userClient.address !== address) {
    _userClient = { address, client: buildClient(getUserSigner()) };
  }
  return _userClient.client;
}

// Test hooks — not part of the public API.
export function _resetUserClientForTests(): void { _userClient = null; }
export function getUserClientForTests(): AsyncBulletinClient { return getUserClient(); }
```

- [ ] **Step 3: Run tests**

```bash
cd web && npm test -- useBulletinUpload
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useBulletinUpload.ts web/src/hooks/useBulletinUpload.test.ts
git commit -m "P2d: invalidate Bulletin user-client when selected address changes (TDD)"
```

---

## Task 8 — `<WalletPicker />` component (TDD)

**Files:**
- Create: `web/src/components/WalletPicker.tsx`
- Create: `web/src/components/WalletPicker.test.tsx`

Four states: `disconnected` → Connect button; `connecting` → spinner text; `connected` with zero accounts → genesis-hash hint; `connected` with accounts → `<select>`. No wallet-chooser dropdown (scope carve-out).

- [ ] **Step 1: Write the test**

```tsx
// web/src/components/WalletPicker.test.tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SignerState } from '@polkadot-apps/signer';

const connectMock = vi.fn();
const selectAccountMock = vi.fn();
let mockState: SignerState = {
  status: 'disconnected',
  accounts: [],
  selectedAccount: null,
  activeProvider: null,
  error: null,
};

vi.mock('../hooks/signerManager', () => ({
  manager: {
    connect: (...args: unknown[]) => connectMock(...args),
    selectAccount: (...args: unknown[]) => selectAccountMock(...args),
  },
  useSignerState: () => mockState,
}));

import { WalletPicker } from './WalletPicker';

function resetState(next: Partial<SignerState> = {}): void {
  mockState = {
    status: 'disconnected',
    accounts: [],
    selectedAccount: null,
    activeProvider: null,
    error: null,
    ...next,
  };
}

describe('WalletPicker', () => {
  beforeEach(() => {
    connectMock.mockReset();
    selectAccountMock.mockReset();
    resetState();
  });

  test('renders Connect button when disconnected', () => {
    resetState({ status: 'disconnected' });
    render(<WalletPicker />);
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeTruthy();
  });

  test('clicking Connect calls manager.connect()', () => {
    resetState({ status: 'disconnected' });
    render(<WalletPicker />);
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  test('shows connecting text when status is connecting', () => {
    resetState({ status: 'connecting' });
    render(<WalletPicker />);
    expect(screen.getByText(/connecting/i)).toBeTruthy();
  });

  test('shows genesis-hash hint when connected with zero accounts', () => {
    resetState({ status: 'connected', accounts: [], activeProvider: 'extension' });
    render(<WalletPicker />);
    expect(screen.getByText(/allow use on any network/i)).toBeTruthy();
  });

  test('renders account select when connected with accounts', () => {
    const acct = {
      address: '5Grw...',
      name: 'Demo',
      h160Address: '0x0' as const,
      publicKey: new Uint8Array(),
      source: 'extension' as const,
      getSigner: () => ({} as never),
    };
    resetState({
      status: 'connected',
      accounts: [acct],
      selectedAccount: acct,
      activeProvider: 'extension',
    });
    render(<WalletPicker />);
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    expect(screen.getByRole('option', { name: /demo/i })).toBeTruthy();
  });

  test('changing select calls manager.selectAccount', () => {
    const a = { address: '5Grw...', name: 'A', h160Address: '0x0' as const, publicKey: new Uint8Array(), source: 'extension' as const, getSigner: () => ({} as never) };
    const b = { address: '5HBu...', name: 'B', h160Address: '0x0' as const, publicKey: new Uint8Array(), source: 'extension' as const, getSigner: () => ({} as never) };
    resetState({ status: 'connected', accounts: [a, b], selectedAccount: a, activeProvider: 'extension' });
    render(<WalletPicker />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5HBu...' } });
    expect(selectAccountMock).toHaveBeenCalledWith('5HBu...');
  });
});
```

- [ ] **Step 2: Create `WalletPicker.tsx`**

```tsx
// web/src/components/WalletPicker.tsx
import { manager, useSignerState } from '../hooks/signerManager';
import { truncateAddress } from '../utils/format';

export function WalletPicker() {
  const state = useSignerState();

  if (state.status === 'connecting') {
    return <span className="text-xs text-text-muted">Connecting…</span>;
  }

  if (state.status === 'disconnected') {
    return (
      <button
        type="button"
        onClick={() => { void manager.connect(); }}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-polka-500/15 border border-polka-500/25 text-white hover:bg-polka-500/25 transition-colors"
      >
        Connect wallet
      </button>
    );
  }

  if (state.accounts.length === 0) {
    return (
      <span className="text-xs text-accent-yellow max-w-xs">
        No accounts visible. In Talisman, enable "Allow use on any network"
        for the account you want to use.
      </span>
    );
  }

  return (
    <select
      value={state.selectedAccount?.address ?? ''}
      onChange={(e) => { manager.selectAccount(e.target.value); }}
      className="px-2 py-1 rounded-md text-xs font-mono bg-white/[0.04] border border-white/[0.08] text-text-primary max-w-[18rem]"
    >
      {!state.selectedAccount && <option value="">Select account…</option>}
      {state.accounts.map((a) => (
        <option key={a.address} value={a.address}>
          {a.name ?? truncateAddress(a.address)}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 3: Run tests**

```bash
cd web && npm test -- WalletPicker
```

Expected: PASS on all 6 tests.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WalletPicker.tsx web/src/components/WalletPicker.test.tsx
git commit -m "P2d: WalletPicker component — four-state header picker (TDD)"
```

---

## Task 9 — Mount `<WalletPicker />` in `App.tsx`

**Files:**
- Modify: `web/src/App.tsx`

Replace the current top-right "truncateAddress + balance pill / Pair-your-Polkadot-App" block with `<WalletPicker />` for the account, keeping the balance display next to it when an account is selected.

- [ ] **Step 1: Update `App.tsx`**

Replace the block `web/src/App.tsx:70-87` (the `<div className="ml-auto flex items-center gap-2 shrink-0">...</div>` block) with:

```tsx
<div className="ml-auto flex items-center gap-2 shrink-0">
  <span
    className={`w-2 h-2 rounded-full transition-colors duration-500 ${
      connected
        ? "bg-accent-green shadow-[0_0_6px_rgba(52,211,153,0.5)]"
        : "bg-text-muted"
    }`}
  />
  <WalletPicker />
  {account && (
    <span className="text-xs text-text-tertiary font-mono">
      {formatDot(balance)}
    </span>
  )}
</div>
```

Add the import at the top of `App.tsx`:

```tsx
import { WalletPicker } from "./components/WalletPicker";
```

Remove the now-unused `truncateAddress` import if no other usage remains in the file.

- [ ] **Step 2: Typecheck**

```bash
cd web && npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run the full test suite**

```bash
cd web && npm test
```

Expected: all suites PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "P2d: mount WalletPicker in App header"
```

---

## Task 10 — Spec update: Talisman-everywhere, drop Bob pin

**Files:**
- Modify: `docs/design/spec.md` (§5.1 purchase flow, §6 account model)

Per project convention, doc commits require explicit per-commit approval. Present the diff and ask before committing.

- [ ] **Step 1: Update §6 "Account model"**

Locate the account-model bullet that mentions the "non-Alice dev account (Bob by default)" pin. Replace it with:

> **Account model.** One Polkadot account per user. In all environments (local Zombienet demo and host/prod), the user signs parachain extrinsics and Bulletin `store()` with a browser-extension wallet (Talisman, Polkadot.js, SubWallet) discovered via `@polkadot-apps/signer`. A small header picker exposes every account the extension has enabled for the chain; selection persists across reloads. When the app is embedded in a Polkadot host, `@polkadot-apps/signer` auto-detects and uses the host account instead of the extension.

- [ ] **Step 2: Update §6 "Signers" bullet**

Replace the existing two-signer bullet with:

> **Signers.** **Alice** — an hdkd `//Alice` keypair held by the frontend — signs Bulletin `authorize_account` exclusively, and only in dev (Zombienet) contexts. The **user** signer — sourced from the extension wallet via `@polkadot-apps/signer` — signs every parachain extrinsic and Bulletin `store()`. The split exists because, on Zombienet, Alice has privileged Bulletin authorization rights at genesis while the user does not; on production Bulletin (Paseo), the user authorizes their own account and Alice is not involved.

- [ ] **Step 3: Update §5.1 purchase flow**

Find any reference to the user being a hard-coded dev account and replace with "the extension-provided user account (`manager.getSigner()` from `signerManager.ts`)".

- [ ] **Step 4: Show the diff, ask for approval**

```bash
git diff docs/design/spec.md
```

Present the diff to the user. Wait for explicit commit approval.

- [ ] **Step 5: Commit (after approval)**

```bash
git add docs/design/spec.md
git commit -m "docs(spec): Talisman-everywhere user signer — drop dev-mode Bob pin"
```

---

## Task 11 — Zombienet + Talisman manual smoke

**Files:** none (manual verification).

No automated harness exists for browser-extension flows and building one is out of scope. This task is manual verification + a typecheck backstop.

- [ ] **Step 1: Final typecheck + test run**

```bash
cd web && npx tsc --noEmit && npm test
```

Expected: PASS on both.

- [ ] **Step 2: Dev-server smoke against Zombienet**

In one terminal:

```bash
./scripts/start-local.sh
```

Wait for parachain to produce blocks. In another:

```bash
cd web && npm run dev
```

Open the dev-server URL in a browser that has Talisman installed with at least one account enabled for generic-substrate (prefix 42).

- [ ] **Step 3: Verify happy path**

Perform in the browser:

1. Click "Connect wallet" in the header. Talisman popup appears.
2. Approve. The picker dropdown appears showing your Talisman accounts.
3. Select an account. Address appears next to the balance indicator.
4. Reload the page. The same account is auto-selected with no Talisman popup.
5. Attempt a purchase on any existing listing. Talisman popup shows the signing request. (The tx will likely fail at balance check because funding is out of scope — but the **signing request must appear**, which confirms the wallet wiring is correct.)

- [ ] **Step 4: Verify the zero-accounts hint**

In Talisman, disable "Allow use on any network" on every account. Reload. The picker should show the "enable Allow use on any network" hint.

- [ ] **Step 5: Nothing to commit**

Report validation result to the user. No commit for this task.

---

## Validation prompt template

After each source commit (Tasks 1–9), surface the following and wait for user confirmation before flipping the `[x]` in `progress.md`:

> Task N landed. Run `cd web && npm test -- <relevant-pattern>` and `cd web && npx tsc --noEmit`. Confirm both green and I'll tick the box.

Task 10 requires explicit "commit approval" prompt. Task 11 requires manual browser verification — user confirms personally.
