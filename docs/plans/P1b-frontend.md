# P1b — Frontend MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 MVP frontend — Browse, Listing Detail (states 1 + 2 + creator), Create, and My Purchases — running inside the Polkadot Triangle sandbox with a Zombienet dev-mode fallback, using PAPI to read/write `pallet-content-registry` and `@parity/bulletin-sdk` for Bulletin Chain uploads.

**Architecture:** React 18 + Vite + Tailwind (already configured). Zustand for global state (account address, balance, connected). Module-level singletons for PAPI clients (following existing `useChain.ts` pattern). Triangle detection via `sandboxProvider.isCorrectEnvironment()`; dev-mode fallback uses direct WS to Zombienet + a pinned non-Alice dev user (Bob). Two Bulletin signers: **Alice** signs `authorize_account` when the user's on-chain quota is insufficient; the **user** signs `store()` for thumbnails and content. Quota is queried on-chain before every upload (no in-memory cache). IPFS reads via `https://paseo-ipfs.polkadot.io/ipfs/<cid>` gateway.

**Tech Stack:** React 18, Vite 6, Tailwind 3, `polkadot-api` 1.23, `@novasamatech/product-sdk` 0.6+, `@parity/bulletin-sdk` 0.1, `blakejs`, `multiformats`, `zustand` 5, `react-router-dom` 7, Vitest 2 (utility tests only)

**Scope carve-outs (not in this plan):**
- Content encryption — Phase 2
- `register_encryption_key`, `batch_all`, `WrappedKeys` — Phase 2
- Listing Detail states 3, 4 — Phase 2
- `locked_content_lock_key` is always submitted as empty bytes in Phase 1

**Prerequisites:** P1a Tasks 17–19 must be complete (runtime benchmarks registered, release build, Zombienet E2E smoke script passing). PAPI descriptor `stack_template` must expose `ContentRegistry` pallet after regeneration in Task 1.

---

## File Structure

**Created:**
- `web/src/pages/BrowsePage.tsx` — `/` route; listing grid
- `web/src/pages/ListingDetailPage.tsx` — `/listing/:id` route
- `web/src/pages/CreatePage.tsx` — `/create` route
- `web/src/pages/PurchasesPage.tsx` — `/purchases` route
- `web/src/pages/NotFoundPage.tsx` — unmatched routes
- `web/src/hooks/useParachainProvider.ts` — Triangle/dev PAPI client + account/signer setup; exports `getParachainApi()`, `getCurrentSigner()`
- `web/src/hooks/useContentRegistry.ts` — typed reads/writes for `pallet-content-registry`
- `web/src/hooks/useBulletinUpload.ts` — `@parity/bulletin-sdk` upload helpers
- `web/src/components/ListingCard.tsx` — card used in Browse + Purchases grids
- `web/src/components/SkeletonCard.tsx` — animated loading placeholder
- `web/src/components/ThumbnailPicker.tsx` — 3-frame canvas extractor
- `web/src/components/CreateChecklist.tsx` — inline step progress for the Create flow
- `web/src/components/VideoPlayer.tsx` — `<video controls>` + IPFS fetch + blake2b integrity badge
- `web/src/utils/bulletinCid.ts` — CID reconstruction from `{codec, digestBytes}` → gateway URL
- `web/src/utils/contentHash.ts` — `verifyContentHash(bytes, expectedHash) → boolean`
- `web/src/utils/bulletinCid.test.ts` — Vitest tests
- `web/src/utils/contentHash.test.ts` — Vitest tests
- `web/vitest.config.ts` — Vitest config

**Modified:**
- `web/package.json` — add `@parity/bulletin-sdk`, add `vitest`
- `web/src/main.tsx` — replace template routes with ppview routes
- `web/src/App.tsx` — replace nav (Browse / My Purchases / Create + account pill)
- `web/src/store/chainStore.ts` — replace state shape (account, balance, connected)

**Untouched (reused):**
- `web/src/hooks/useChain.ts` — `getClient()` singleton; reused by provider
- `web/src/hooks/useAccount.ts` — dev keypairs; dev-mode fallback
- `web/src/utils/cid.ts` — `hexHashToCid`, `ipfsUrl`; referenced by `bulletinCid.ts`
- `web/src/utils/hash.ts` — `hashFile`, `hashFileWithBytes`; used in Create flow

---

## Task 1 — Install dependencies + configure Vitest + regenerate PAPI descriptors

**Files:**
- Modify: `web/package.json`
- Create: `web/vitest.config.ts`

- [ ] **Step 1: Add `@parity/bulletin-sdk` and `vitest` to `web/package.json`**

Edit `web/package.json`. In `"dependencies"` add:

```json
"@parity/bulletin-sdk": "^0.1.0"
```

In `"devDependencies"` add:

```json
"vitest": "^2.0.0"
```

In `"scripts"` add:

```json
"test": "vitest --run"
```

- [ ] **Step 2: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Install**

```bash
cd web && npm install
```

Expected: `node_modules/@parity/bulletin-sdk` exists; no peer dependency errors.

If `@parity/bulletin-sdk` is not on npm yet, install from the local workspace or GitHub. Check with:

```bash
npm info @parity/bulletin-sdk version
```

- [ ] **Step 4: Regenerate PAPI descriptors against the P1a runtime**

This step requires Zombienet to be running with the P1a runtime. Start it first:

```bash
# In a separate terminal, from repo root:
./scripts/start-local.sh
```

Wait for the parachain to produce blocks (collator logs show `✓ imported`), then:

```bash
cd web && npm run codegen
```

Expected: `.papi/descriptors/dist/stack_template.d.ts` now exports `ContentRegistry` in the typed API surface. Verify:

```bash
grep -l "ContentRegistry" web/.papi/descriptors/dist/stack_template.d.ts
```

Expected: the file is listed (pattern found).

- [ ] **Step 5: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors. Existing template pages may produce unused-import warnings — those are acceptable until we remove them in Task 4.

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.ts web/.papi
git commit -m "P1b: install bulletin-sdk + vitest, regenerate PAPI descriptors"
```

---

## Task 2 — Utility functions: CID reconstruction + content hash verification

Pure functions with no React or PAPI dependencies. TDD with Vitest.

**Files:**
- Create: `web/src/utils/bulletinCid.ts`
- Create: `web/src/utils/contentHash.ts`
- Create: `web/src/utils/bulletinCid.test.ts`
- Create: `web/src/utils/contentHash.test.ts`

- [ ] **Step 1: Write failing tests for `bulletinCid.ts`**

Create `web/src/utils/bulletinCid.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { bulletinCidToString, bulletinCidToGatewayUrl } from './bulletinCid';

describe('bulletinCidToString', () => {
  test('produces a CIDv1 base32 string for raw codec', () => {
    const codec = 0x55;
    const digestBytes = new Uint8Array(32).fill(0xab);
    const cid = bulletinCidToString(codec, digestBytes);
    // CIDv1 encoded in base32 always starts with 'b' (multibase prefix)
    expect(cid).toMatch(/^b/);
    expect(typeof cid).toBe('string');
    expect(cid.length).toBeGreaterThan(10);
  });

  test('same inputs produce the same CID', () => {
    const codec = 0x55;
    const digestBytes = new Uint8Array(32).fill(0xcc);
    expect(bulletinCidToString(codec, digestBytes)).toBe(bulletinCidToString(codec, digestBytes));
  });

  test('different digests produce different CIDs', () => {
    const a = new Uint8Array(32).fill(0x01);
    const b = new Uint8Array(32).fill(0x02);
    expect(bulletinCidToString(0x55, a)).not.toBe(bulletinCidToString(0x55, b));
  });
});

describe('bulletinCidToGatewayUrl', () => {
  test('wraps the CID string in the Paseo IPFS gateway URL', () => {
    const codec = 0x55;
    const digestBytes = new Uint8Array(32).fill(0xab);
    const url = bulletinCidToGatewayUrl(codec, digestBytes);
    const cid = bulletinCidToString(codec, digestBytes);
    expect(url).toBe(`https://paseo-ipfs.polkadot.io/ipfs/${cid}`);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd web && npm test -- --reporter=verbose src/utils/bulletinCid.test.ts
```

Expected: FAIL — `bulletinCid` module not found.

- [ ] **Step 3: Implement `web/src/utils/bulletinCid.ts`**

```ts
import { CID } from 'multiformats/cid';
import * as digest from 'multiformats/hashes/digest';

const BLAKE2B_256_CODE = 0xb220;
const IPFS_GATEWAY = 'https://paseo-ipfs.polkadot.io/ipfs';

/**
 * Reconstruct an IPFS CIDv1 string from a pallet BulletinCid's codec + blake2b-256 digest.
 * `codec` is 0x55 (raw) for single-chunk uploads or 0x70 (dag-pb) for chunked.
 */
export function bulletinCidToString(codec: number, digestBytes: Uint8Array): string {
  const mh = digest.create(BLAKE2B_256_CODE, digestBytes);
  return CID.createV1(codec, mh).toString();
}

/**
 * Full Paseo IPFS gateway URL for a pallet BulletinCid.
 */
export function bulletinCidToGatewayUrl(codec: number, digestBytes: Uint8Array): string {
  return `${IPFS_GATEWAY}/${bulletinCidToString(codec, digestBytes)}`;
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd web && npm test -- --reporter=verbose src/utils/bulletinCid.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Write failing tests for `contentHash.ts`**

Create `web/src/utils/contentHash.test.ts`:

```ts
import { describe, test, expect } from 'vitest';
import { blake2b } from 'blakejs';
import { verifyContentHash } from './contentHash';

describe('verifyContentHash', () => {
  test('returns true when bytes hash matches expected', () => {
    const bytes = new TextEncoder().encode('hello world');
    const expected = blake2b(bytes, undefined, 32);
    expect(verifyContentHash(bytes, expected)).toBe(true);
  });

  test('returns false when hash does not match', () => {
    const bytes = new TextEncoder().encode('hello world');
    const wrong = new Uint8Array(32); // all zeros
    expect(verifyContentHash(bytes, wrong)).toBe(false);
  });

  test('returns false for empty expected hash', () => {
    const bytes = new TextEncoder().encode('data');
    expect(verifyContentHash(bytes, new Uint8Array(32))).toBe(false);
  });
});
```

- [ ] **Step 6: Run tests — expect failure**

```bash
cd web && npm test -- --reporter=verbose src/utils/contentHash.test.ts
```

Expected: FAIL — `contentHash` module not found.

- [ ] **Step 7: Implement `web/src/utils/contentHash.ts`**

```ts
import { blake2b } from 'blakejs';

/**
 * Returns true if blake2b-256(bytes) equals expectedHash.
 * Used to verify content integrity after fetching from IPFS.
 */
export function verifyContentHash(bytes: Uint8Array, expectedHash: Uint8Array): boolean {
  const actual = blake2b(bytes, undefined, 32);
  if (actual.length !== expectedHash.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expectedHash[i]) return false;
  }
  return true;
}
```

- [ ] **Step 8: Run all utility tests**

```bash
cd web && npm test
```

Expected: 7 tests pass across both files.

- [ ] **Step 9: Commit**

```bash
git add web/src/utils/bulletinCid.ts web/src/utils/bulletinCid.test.ts \
        web/src/utils/contentHash.ts web/src/utils/contentHash.test.ts
git commit -m "P1b: add bulletinCid and contentHash utilities with tests"
```

---

## Task 3 — Store refactor + parachain provider hook

Replace the template-era `chainStore.ts` with a simpler shape. Create `useParachainProvider.ts` that detects Triangle vs dev mode, sets up the PAPI client, and fetches the current account.

**Files:**
- Modify: `web/src/store/chainStore.ts`
- Create: `web/src/hooks/useParachainProvider.ts`

- [ ] **Step 1: Rewrite `web/src/store/chainStore.ts`**

Replace the entire file:

```ts
import { create } from 'zustand';

interface ChainState {
  account: string | null;
  balance: bigint;
  connected: boolean;
  setAccount: (account: string | null) => void;
  setBalance: (balance: bigint) => void;
  setConnected: (connected: boolean) => void;
}

export const useChainStore = create<ChainState>((set) => ({
  account: null,
  balance: 0n,
  connected: false,
  setAccount: (account) => set({ account }),
  setBalance: (balance) => set({ balance }),
  setConnected: (connected) => set({ connected }),
}));
```

- [ ] **Step 2: Create `web/src/hooks/useParachainProvider.ts`**

```ts
import { createClient, AccountId, type PolkadotClient, type PolkadotSigner, type TypedApi } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import {
  sandboxProvider,
  sandboxTransport,
  createPapiProvider,
  createAccountsProvider,
  hostApi,
} from '@novasamatech/product-sdk';
import { enumValue } from '@novasamatech/host-api';
import { stack_template } from '@polkadot-api/descriptors';
import { useEffect } from 'react';
import { useChainStore } from '../store/chainStore';
import { devAccounts } from './useAccount';

const PPVIEW_GENESIS = '0x4545454545454545454545454545454545454545454545454545454545454545';
const DEV_WS = 'ws://127.0.0.1:9944';
const SS58_PREFIX = 42;

const addressCodec = AccountId(SS58_PREFIX);

type ParachainApi = TypedApi<typeof stack_template>;

let _parachainClient: PolkadotClient | null = null;
let _parachainApi: ParachainApi | null = null;
let _currentSigner: PolkadotSigner | null = null;

export function getParachainApi(): ParachainApi {
  if (!_parachainApi) throw new Error('Parachain provider not initialized');
  return _parachainApi;
}

export function getCurrentSigner(): PolkadotSigner {
  if (!_currentSigner) throw new Error('No signer — provider not initialized');
  return _currentSigner;
}

async function initProvider(): Promise<{ address: string | null }> {
  const inHost = sandboxProvider.isCorrectEnvironment();

  if (inHost) {
    // Request transaction permission from the host once.
    await hostApi
      .permission(enumValue('v1', { tag: 'TransactionSubmit', value: undefined }))
      .match(
        () => {},
        (err: unknown) => console.warn('Transaction permission denied:', err),
      );

    const papiProvider = createPapiProvider(PPVIEW_GENESIS);
    _parachainClient = createClient(papiProvider);
    _parachainApi = _parachainClient.getTypedApi(stack_template);

    const accountsProvider = createAccountsProvider(sandboxTransport);
    const res = await accountsProvider.getNonProductAccounts();
    const acct = res.match(
      (accts: { publicKey: Uint8Array; name?: string }[]) => accts[0] ?? null,
      () => null,
    );

    if (acct) {
      const address = addressCodec.dec(acct.publicKey);
      _currentSigner = accountsProvider.getNonProductAccountSigner(acct as any);
      return { address };
    }
    return { address: null };
  } else {
    // Dev mode: direct Zombienet WS + Alice dev key.
    _parachainClient = createClient(withPolkadotSdkCompat(getWsProvider(DEV_WS)));
    _parachainApi = _parachainClient.getTypedApi(stack_template);
    _currentSigner = devAccounts[0].signer;
    return { address: devAccounts[0].address };
  }
}

/**
 * Mount this hook once in App. Initializes the PAPI client, gets the account,
 * and subscribes to balance updates.
 */
export function useParachainProvider() {
  const setAccount = useChainStore((s) => s.setAccount);
  const setBalance = useChainStore((s) => s.setBalance);
  const setConnected = useChainStore((s) => s.setConnected);

  useEffect(() => {
    let balanceSub: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    initProvider()
      .then(({ address }) => {
        if (cancelled) return;
        setAccount(address);
        setConnected(true);

        if (address && _parachainApi) {
          balanceSub = _parachainApi.query.System.Account.watchValue(address).subscribe({
            next: (info: { data: { free: bigint } }) => setBalance(info.data.free),
            error: (err: unknown) => console.error('Balance subscription error:', err),
          });
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      balanceSub?.unsubscribe();
    };
  }, [setAccount, setBalance, setConnected]);
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors related to the new files. There may be errors in old template pages that reference `pallets.templatePallet` — those are resolved in Task 4 when we remove the old pages from routing. Skip them for now.

If `@novasamatech/host-api` is missing (the `enumValue` import), add it to `package.json` under `dependencies`:

```json
"@novasamatech/host-api": "*"
```

Then re-run `npm install` and retry.

- [ ] **Step 4: Commit**

```bash
git add web/src/store/chainStore.ts web/src/hooks/useParachainProvider.ts web/package.json web/package-lock.json
git commit -m "P1b: refactor chain store and add Triangle/dev parachain provider hook"
```

---

## Task 4 — App shell: new nav + routes + stub pages

Replace `App.tsx` and `main.tsx`. Stub pages are placeholder components that will be filled in later tasks.

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/main.tsx`
- Create: `web/src/pages/NotFoundPage.tsx`
- Create: (stub) `web/src/pages/BrowsePage.tsx`
- Create: (stub) `web/src/pages/ListingDetailPage.tsx`
- Create: (stub) `web/src/pages/CreatePage.tsx`
- Create: (stub) `web/src/pages/PurchasesPage.tsx`

- [ ] **Step 1: Create `web/src/pages/NotFoundPage.tsx`**

```tsx
import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-4">
      <p className="text-4xl font-bold text-text-primary">404</p>
      <p className="text-text-secondary">Page not found</p>
      <Link to="/" className="text-polka-400 hover:text-polka-300 text-sm">
        ← Back to Browse
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Create stub pages**

Create `web/src/pages/BrowsePage.tsx`:

```tsx
export default function BrowsePage() {
  return <p className="text-text-secondary">Browse — coming soon</p>;
}
```

Create `web/src/pages/ListingDetailPage.tsx`:

```tsx
export default function ListingDetailPage() {
  return <p className="text-text-secondary">Listing detail — coming soon</p>;
}
```

Create `web/src/pages/CreatePage.tsx`:

```tsx
export default function CreatePage() {
  return <p className="text-text-secondary">Create — coming soon</p>;
}
```

Create `web/src/pages/PurchasesPage.tsx`:

```tsx
export default function PurchasesPage() {
  return <p className="text-text-secondary">My Purchases — coming soon</p>;
}
```

- [ ] **Step 3: Rewrite `web/src/main.tsx`**

Replace the entire file:

```tsx
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import App from './App';
import './index.css';

const BrowsePage = lazy(() => import('./pages/BrowsePage'));
const ListingDetailPage = lazy(() => import('./pages/ListingDetailPage'));
const CreatePage = lazy(() => import('./pages/CreatePage'));
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const fallback = (
  <div className="flex items-center justify-center h-32">
    <div className="w-5 h-5 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Suspense fallback={fallback}><BrowsePage /></Suspense>} />
          <Route path="listing/:id" element={<Suspense fallback={fallback}><ListingDetailPage /></Suspense>} />
          <Route path="create" element={<Suspense fallback={fallback}><CreatePage /></Suspense>} />
          <Route path="purchases" element={<Suspense fallback={fallback}><PurchasesPage /></Suspense>} />
          <Route path="*" element={<Suspense fallback={fallback}><NotFoundPage /></Suspense>} />
        </Route>
      </Routes>
    </HashRouter>
  </StrictMode>,
);
```

- [ ] **Step 4: Rewrite `web/src/App.tsx`**

Replace the entire file:

```tsx
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useChainStore } from './store/chainStore';
import { useParachainProvider } from './hooks/useParachainProvider';

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatDot(planck: bigint): string {
  // 1 DOT = 10^10 planck on a standard Polkadot parachain
  const dot = Number(planck) / 1e10;
  return `${dot.toFixed(2)} DOT`;
}

export default function App() {
  const account = useChainStore((s) => s.account);
  const balance = useChainStore((s) => s.balance);
  const connected = useChainStore((s) => s.connected);

  useParachainProvider();

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `relative px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
      isActive
        ? 'text-white'
        : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
    }`;

  return (
    <div className="min-h-screen bg-pattern relative">
      <div className="gradient-orb" style={{ background: '#e6007a', top: '-200px', right: '-100px' }} />
      <div className="gradient-orb" style={{ background: '#4cc2ff', bottom: '-200px', left: '-100px' }} />

      <nav className="sticky top-0 z-50 border-b border-white/[0.06] backdrop-blur-xl bg-surface-950/80">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-6">
          {/* App name */}
          <span className="text-base font-semibold text-text-primary font-display tracking-tight shrink-0">
            ppview
          </span>

          {/* Nav links */}
          <div className="flex gap-0.5 overflow-x-auto">
            <NavLink to="/" end className={navLinkClass}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-0 rounded-lg bg-polka-500/15 border border-polka-500/25" />}
                  <span className="relative">Browse</span>
                </>
              )}
            </NavLink>
            <NavLink to="/purchases" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-0 rounded-lg bg-polka-500/15 border border-polka-500/25" />}
                  <span className="relative">My Purchases</span>
                </>
              )}
            </NavLink>
            <NavLink to="/create" className={navLinkClass}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-0 rounded-lg bg-polka-500/15 border border-polka-500/25" />}
                  <span className="relative">Create</span>
                </>
              )}
            </NavLink>
          </div>

          {/* Account pill */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span
              className={`w-2 h-2 rounded-full transition-colors duration-500 ${
                connected ? 'bg-accent-green shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-text-muted'
              }`}
            />
            {account ? (
              <span className="text-xs text-text-tertiary font-mono">
                {truncateAddress(account)} · {formatDot(balance)}
              </span>
            ) : (
              <span className="text-xs text-text-muted">No account</span>
            )}
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-5xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors in the new files. Old template files that are no longer imported may produce "file not included in project" warnings — ignore them.

- [ ] **Step 6: Visual check — dev server**

```bash
cd web && npm run dev
```

Open `http://localhost:5173`. Verify:
- Nav shows "ppview" app name + Browse / My Purchases / Create links
- Active nav link is highlighted when navigating to each route
- Account pill shows truncated Alice address + balance (in dev mode)
- Stub pages render on each route; `*` route renders 404

- [ ] **Step 7: Commit**

```bash
git add web/src/App.tsx web/src/main.tsx web/src/pages/
git commit -m "P1b: replace app shell — new nav, routes, and stub pages"
```

---

## Task 5 — ContentRegistry PAPI hook

Typed wrappers for reading and writing `pallet-content-registry` via the parachain PAPI client.

**Files:**
- Create: `web/src/hooks/useContentRegistry.ts`

- [ ] **Step 1: Create `web/src/hooks/useContentRegistry.ts`**

```ts
import { Binary } from 'polkadot-api';
import { getParachainApi, getCurrentSigner } from './useParachainProvider';
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

// ── Internal mapper ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapListing(id: bigint, l: any): Listing {
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

/** Fetch all listings, sorted newest-first by `created_at`. */
export async function fetchAllListings(): Promise<Listing[]> {
  const api = getParachainApi();
  const entries = await api.query.ContentRegistry.Listings.getEntries();
  return entries
    .map(({ keyArgs: [id], value: l }) => mapListing(id, l))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Fetch a single listing by ID. Returns undefined if not found. */
export async function fetchListing(id: bigint): Promise<Listing | undefined> {
  const api = getParachainApi();
  const l = await api.query.ContentRegistry.Listings.getValue(id);
  if (!l) return undefined;
  return mapListing(id, l);
}

/**
 * Prefix-scan the Purchases DoubleMap for a buyer.
 * Returns listing IDs sorted by purchase block descending (most recent first).
 */
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

/** Returns true if `address` has purchased listing `listingId`. */
export async function hasPurchased(address: string, listingId: bigint): Promise<boolean> {
  const api = getParachainApi();
  const result = await api.query.ContentRegistry.Purchases.getValue(address, listingId);
  return result !== undefined;
}

// ── Writes ────────────────────────────────────────────────────────────────────

export interface CreateListingParams {
  contentCid: BulletinCidFields;
  thumbnailCid: BulletinCidFields;
  contentHash: Uint8Array;
  title: string;
  description: string;
  price: bigint;
}

/**
 * Submit `create_listing`. Returns the new listing ID.
 * Throws if the transaction fails.
 */
export async function submitCreateListing(params: CreateListingParams): Promise<bigint> {
  const api = getParachainApi();
  const signer = getCurrentSigner();

  const tx = api.tx.ContentRegistry.create_listing({
    content_cid: {
      codec: params.contentCid.codec,
      digest: Binary.fromBytes(params.contentCid.digestBytes),
    },
    thumbnail_cid: {
      codec: params.thumbnailCid.codec,
      digest: Binary.fromBytes(params.thumbnailCid.digestBytes),
    },
    content_hash: Binary.fromBytes(params.contentHash),
    title: Binary.fromText(params.title),
    description: Binary.fromText(params.description),
    price: params.price,
    locked_content_lock_key: Binary.fromBytes(new Uint8Array()),
  });

  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`create_listing failed: ${JSON.stringify(result)}`);

  const nextId = await api.query.ContentRegistry.NextListingId.getValue();
  return nextId - 1n;
}

/**
 * Submit `purchase(listing_id)`. Throws if the transaction fails.
 * Phase 1: called directly (no batch_all — Phase 2 adds register_encryption_key).
 */
export async function submitPurchase(listingId: bigint): Promise<void> {
  const api = getParachainApi();
  const signer = getCurrentSigner();

  const tx = api.tx.ContentRegistry.purchase({ listing_id: listingId });
  const result = await tx.signAndSubmit(signer);
  if (!result.ok) throw new Error(`purchase failed: ${JSON.stringify(result)}`);
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors. If PAPI's generated types use different names (e.g. camelCase instead of snake_case for extrinsic arguments), adjust the property names to match what `web/.papi/descriptors/dist/stack_template.d.ts` actually exports. The smoke script from P1a Task 19 uses the same field names — they should match.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useContentRegistry.ts
git commit -m "P1b: add ContentRegistry PAPI hook (fetchAllListings, fetchListing, fetchPurchases, submitCreateListing, submitPurchase)"
```

---

## Task 6 — Bulletin upload hook

Wraps `@parity/bulletin-sdk` for uploading content + thumbnails to Bulletin Chain. Uses Alice dev key for `authorizePreimage`; stores are unsigned (preimage-authorized).

**Files:**
- Create: `web/src/hooks/useBulletinUpload.ts`

- [ ] **Step 1: Create `web/src/hooks/useBulletinUpload.ts`**

```ts
import { createClient, type PolkadotClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import {
  AsyncBulletinClient,
  getContentHash,
  HashAlgorithm,
  type BulletinError,
} from '@parity/bulletin-sdk';
import { bulletin } from '@polkadot-api/descriptors';
import { devAccounts } from './useAccount';
import type { BulletinCidFields } from './useContentRegistry';

const BULLETIN_WS = 'wss://paseo-bulletin-rpc.polkadot.io';

let _bulletinPapiClient: PolkadotClient | null = null;
let _asyncClient: AsyncBulletinClient | null = null;

function getBulletinClient(): AsyncBulletinClient {
  if (!_bulletinPapiClient) {
    _bulletinPapiClient = createClient(
      withPolkadotSdkCompat(getWsProvider(BULLETIN_WS)),
    );
  }
  if (!_asyncClient) {
    const api = _bulletinPapiClient.getTypedApi(bulletin);
    // Alice is in TransactionStorage::Authorizer's TestAccounts on Paseo Bulletin.
    const aliceSigner = devAccounts[0].signer;
    _asyncClient = new AsyncBulletinClient(api, aliceSigner, (_bulletinPapiClient as any).submit);
  }
  return _asyncClient;
}

/**
 * Authorize a preimage and upload `bytes` to Bulletin Chain, returning
 * the codec + blake2b-256 digest needed for the pallet's BulletinCid.
 *
 * Progress is reported as a 0–100 percentage via `onProgress`.
 * Throws `BulletinError` on SDK-level failures; check `.isRetryable` before retrying.
 */
export async function uploadToBulletin(
  bytes: Uint8Array,
  onProgress?: (pct: number) => void,
): Promise<BulletinCidFields> {
  const client = getBulletinClient();

  // 1. Compute content hash for preimage authorization (offline — no network).
  const contentHash = await getContentHash(bytes, HashAlgorithm.Blake2b256);

  // 2. Authorize the preimage on Bulletin (Alice signs — feeless on Paseo testnet).
  await client.authorizePreimage(contentHash, bytes.length).send();

  // 3. Store unsigned (preimage authorization already covers the write).
  let total = 1;
  const result = await client
    .store(bytes)
    .withCallback((event) => {
      if (event.type === 'ChunkCompleted') {
        total = event.total;
        onProgress?.(((event.index + 1) / total) * 100);
      }
    })
    .sendUnsigned();

  if (!result.cid) throw new Error('Bulletin upload succeeded but returned no CID');

  const cid = result.cid;
  return {
    codec: cid.code,
    digestBytes: new Uint8Array(cid.multihash.digest),
  };
}

/**
 * Fetch raw bytes from the Paseo IPFS gateway.
 * Throws on HTTP error or network failure.
 */
export async function fetchFromIpfs(cid: BulletinCidFields): Promise<Uint8Array> {
  const { bulletinCidToGatewayUrl } = await import('../utils/bulletinCid');
  const url = bulletinCidToGatewayUrl(cid.codec, cid.digestBytes);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status} ${res.statusText}`);
  return new Uint8Array(await res.arrayBuffer());
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors. If `(AsyncBulletinClient as any)` or the `submit` cast produces a type error, adjust:
- Check `_bulletinPapiClient.submit` is accessible on the PAPI `PolkadotClient` type. If not, cast: `(_bulletinPapiClient as any).submit`.
- Verify `BulletinError` is exported from `@parity/bulletin-sdk` — it is per the reference.

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useBulletinUpload.ts
git commit -m "P1b: add Bulletin upload hook using bulletin-sdk preimage-authorized store"
```

---

## Task 7 — Browse page + ListingCard + SkeletonCard

**Files:**
- Create: `web/src/components/SkeletonCard.tsx`
- Create: `web/src/components/ListingCard.tsx`
- Modify: `web/src/pages/BrowsePage.tsx` (replace stub)

- [ ] **Step 1: Create `web/src/components/SkeletonCard.tsx`**

```tsx
export default function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-surface-900 border border-white/[0.06] animate-pulse">
      {/* Thumbnail placeholder — 16:9 */}
      <div className="w-full aspect-video bg-white/[0.06]" />
      <div className="p-3 flex flex-col gap-2">
        <div className="h-4 w-3/4 rounded bg-white/[0.06]" />
        <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
        <div className="h-3 w-1/4 rounded bg-white/[0.04] self-end" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `web/src/components/ListingCard.tsx`**

```tsx
import { useNavigate } from 'react-router-dom';
import type { Listing } from '../hooks/useContentRegistry';

interface Props {
  listing: Listing;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatDot(planck: bigint): string {
  return `${(Number(planck) / 1e10).toFixed(2)} DOT`;
}

export default function ListingCard({ listing }: Props) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/listing/${listing.id}`)}
      className="rounded-xl overflow-hidden bg-surface-900 border border-white/[0.06] cursor-pointer
                 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-glow"
    >
      {/* Thumbnail — 16:9 */}
      <div className="w-full aspect-video bg-surface-800 overflow-hidden">
        <img
          src={listing.thumbnailUrl}
          alt={listing.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      </div>

      <div className="p-3 flex flex-col gap-1">
        {/* Title — clamp to 2 lines */}
        <p className="text-sm font-medium text-text-primary line-clamp-2">{listing.title}</p>
        {/* Creator */}
        <p className="text-xs text-text-muted font-mono">{truncateAddress(listing.creator)}</p>
        {/* Price — right-aligned */}
        <p className="text-xs text-polka-300 font-semibold text-right mt-0.5">
          {formatDot(listing.price)}
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `web/src/pages/BrowsePage.tsx`**

Replace the stub:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllListings, type Listing } from '../hooks/useContentRegistry';
import ListingCard from '../components/ListingCard';
import SkeletonCard from '../components/SkeletonCard';

export default function BrowsePage() {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllListings()
      .then(setListings)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Browse</h1>
        {listings !== null && (
          <span className="text-sm text-text-muted">{listings.length} listing{listings.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-accent-red text-sm">{error}</p>
      )}

      {/* Loading skeleton */}
      {listings === null && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {listings !== null && listings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-text-secondary">No listings yet.</p>
          <Link to="/create" className="text-polka-400 hover:text-polka-300 text-sm">
            Create the first listing
          </Link>
        </div>
      )}

      {/* Grid */}
      {listings !== null && listings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((l) => <ListingCard key={String(l.id)} listing={l} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: TypeScript check + dev server**

```bash
cd web && npx tsc --noEmit
npm run dev
```

Open `http://localhost:5173`. With Zombienet running and a listing already created (from the P1a smoke script), the grid should render. Without a running node, expect a console error and the error state to render.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SkeletonCard.tsx web/src/components/ListingCard.tsx web/src/pages/BrowsePage.tsx
git commit -m "P1b: Browse page with listing grid, skeleton loading, and empty state"
```

---

## Task 8 — VideoPlayer component

Fetches content bytes from IPFS, verifies integrity, renders `<video controls>` with a Blob URL. Used by Listing Detail in Tasks 9.

**Files:**
- Create: `web/src/components/VideoPlayer.tsx`

- [ ] **Step 1: Create `web/src/components/VideoPlayer.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { fetchFromIpfs } from '../hooks/useBulletinUpload';
import { verifyContentHash } from '../utils/contentHash';
import type { BulletinCidFields } from '../hooks/useContentRegistry';

type IntegrityState = 'pending' | 'verified' | 'failed';

interface Props {
  contentCid: BulletinCidFields;
  contentHash: Uint8Array;
}

export default function VideoPlayer({ contentCid, contentHash }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityState>('pending');
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let url: string | null = null;

    fetchFromIpfs(contentCid)
      .then((bytes) => {
        if (revoked) return;
        const ok = verifyContentHash(bytes, contentHash);
        setIntegrity(ok ? 'verified' : 'failed');
        if (!ok) return;
        const blob = new Blob([bytes], { type: 'video/mp4' });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch((e) => {
        if (!revoked) setFetchError(String(e));
      });

    return () => {
      revoked = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [contentCid, contentHash]);

  // Fetch error
  if (fetchError) {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex flex-col items-center justify-center gap-3">
        <p className="text-text-secondary text-sm">Couldn't reach content storage.</p>
        <button
          onClick={() => { setFetchError(null); }}
          className="text-polka-400 hover:text-polka-300 text-sm underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // Integrity failure
  if (integrity === 'failed') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center">
        <p className="text-accent-red text-sm">⚠ Content failed integrity check</p>
      </div>
    );
  }

  // Loading
  if (!blobUrl) {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center animate-pulse">
        <div className="w-8 h-8 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  // Verified + ready
  return (
    <div className="w-full flex flex-col gap-1.5">
      <video
        controls
        src={blobUrl}
        className="w-full rounded-xl bg-black"
      />
      {integrity === 'verified' && (
        <p className="text-xs text-accent-green flex items-center gap-1">
          <span>✓</span> Content verified
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/VideoPlayer.tsx
git commit -m "P1b: VideoPlayer — IPFS fetch, blake2b integrity check, blob URL playback"
```

---

## Task 9 — Listing Detail page

**Files:**
- Modify: `web/src/pages/ListingDetailPage.tsx` (replace stub)

- [ ] **Step 1: Implement `web/src/pages/ListingDetailPage.tsx`**

Replace the stub with the full implementation:

```tsx
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import {
  fetchListing,
  hasPurchased,
  submitPurchase,
  type Listing,
} from '../hooks/useContentRegistry';
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

  const [listing, setListing] = useState<Listing | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [buyStatus, setBuyStatus] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) { setPageState('not-found'); return; }

    const listingId = BigInt(id);
    fetchListing(listingId)
      .then(async (l) => {
        if (!l) { setPageState('not-found'); return; }
        setListing(l);

        if (!account) { setPageState('unpurchased'); return; }

        const purchased = await hasPurchased(account, listingId);
        setPageState(purchased || account === l.creator ? 'purchased' : 'unpurchased');
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
  const listingDate = new Date(listing.createdAt * 6000).toISOString().split('T')[0]; // rough block-time estimate

  async function handleBuy() {
    if (!listing) return;
    setBuyError(null);
    setBuyStatus('Waiting for signature…');
    try {
      await submitPurchase(listing.id);
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

  return (
    <div>
      {/* Back link */}
      <Link to="/" className="text-sm text-text-muted hover:text-text-primary mb-4 inline-block">
        ← Browse
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: media area */}
        <div className="flex-1">
          {pageState === 'purchased' ? (
            <VideoPlayer contentCid={listing.contentCid} contentHash={listing.contentHash} />
          ) : (
            /* State 1: thumbnail + lock overlay */
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-surface-800">
              <img
                src={listing.thumbnailUrl}
                alt={listing.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="text-white/70 text-sm font-medium tracking-wide uppercase">
                  🔒 Preview
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: metadata + action */}
        <div className="lg:w-72 flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-text-primary">{listing.title}</h1>

          {/* Creator */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-mono">{truncateAddress(listing.creator)}</span>
            <button
              onClick={handleCopyAddress}
              className="text-xs text-polka-400 hover:text-polka-300"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Price */}
          <p className="text-lg font-semibold text-polka-300">{formatDot(listing.price)}</p>

          {/* Action area */}
          {pageState === 'purchased' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-accent-green font-medium">✓ Purchased</span>
              {isCreator && (
                <span className="text-xs text-text-muted border border-white/10 rounded px-2 py-0.5">
                  Your listing
                </span>
              )}
            </div>
          )}

          {pageState === 'unpurchased' && !isCreator && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleBuy}
                disabled={!canAfford || !!buyStatus}
                className="w-full py-2.5 rounded-lg bg-polka-500 hover:bg-polka-400 text-white text-sm
                           font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {buyStatus ?? `Buy for ${formatDot(listing.price)}`}
              </button>
              <p className="text-xs text-text-muted">
                Transaction fee paid by you (≈ 0.01 DOT) · Balance: {formatDot(balance)}
              </p>
              {!canAfford && (
                <p className="text-xs text-accent-red">
                  Not enough DOT. Balance: {formatDot(balance)}, needed: {formatDot(listing.price)}
                </p>
              )}
              {buyError && <p className="text-xs text-accent-red">{buyError}</p>}
            </div>
          )}

          {/* Description */}
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{listing.description}</p>

          {/* Footer */}
          <p className="text-xs text-text-muted mt-auto">
            Listed on {listingDate}
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check + dev server**

```bash
cd web && npx tsc --noEmit
npm run dev
```

Navigate to a listing URL (e.g. `http://localhost:5173/#/listing/0`). Verify:
- Unpurchased state shows thumbnail with lock overlay and Buy button
- Purchased state (create a test purchase first via the P1a smoke script) shows VideoPlayer
- Non-existent ID shows "Listing not found"
- Creator address copy button works

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/ListingDetailPage.tsx
git commit -m "P1b: Listing Detail page — unpurchased/purchased/creator states, integrity check"
```

---

## Task 10 — Create page: progressive form (Sections A, B, C)

**Files:**
- Create: `web/src/components/ThumbnailPicker.tsx`
- Modify: `web/src/pages/CreatePage.tsx` (replace stub — Sections A, B, C only)

- [ ] **Step 1: Create `web/src/components/ThumbnailPicker.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';

interface Props {
  videoFile: File;
  onSelect: (thumbnailBytes: Uint8Array) => void;
}

function extractFrame(
  videoEl: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timeSeconds: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    videoEl.currentTime = timeSeconds;
    videoEl.onseeked = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas context')); return; }
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      }, 'image/jpeg', 0.85);
    };
    videoEl.onerror = reject;
  });
}

export default function ThumbnailPicker({ videoFile, onSelect }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<{ url: string; bytes: Uint8Array }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    video.src = url;
    video.muted = true;
    video.preload = 'metadata';

    video.onloadedmetadata = async () => {
      const dur = video.duration;
      const times = [
        dur * 0.2 + Math.random() * dur * 0.05,
        dur * 0.5 + Math.random() * dur * 0.05,
        dur * 0.8 - Math.random() * dur * 0.05,
      ].map((t) => Math.min(Math.max(t, 0), dur - 0.1));

      const extracted: { url: string; bytes: Uint8Array }[] = [];
      for (const t of times) {
        try {
          const bytes = await extractFrame(video, canvas, t);
          extracted.push({ url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })), bytes });
        } catch {
          // skip frames that fail
        }
      }
      setFrames(extracted);
      setLoading(false);
    };

    return () => {
      URL.revokeObjectURL(url);
      frames.forEach((f) => URL.revokeObjectURL(f.url));
    };
  }, [videoFile]);

  function handleSelect(index: number) {
    setSelected(index);
    onSelect(frames[index].bytes);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-sm">
        <div className="w-4 h-4 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
        Extracting thumbnail candidates…
      </div>
    );
  }

  if (frames.length === 0) {
    return <p className="text-accent-red text-sm">Couldn't extract frames from this file.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">Pick a thumbnail.</p>
      <div className="grid grid-cols-3 gap-3">
        {frames.map((f, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i)}
            className={`rounded-lg overflow-hidden border-2 transition-all ${
              selected === i
                ? 'border-polka-500 shadow-glow'
                : 'border-transparent hover:border-white/20'
            }`}
          >
            <img src={f.url} alt={`Frame ${i + 1}`} className="w-full aspect-video object-cover" />
          </button>
        ))}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <video ref={videoRef} className="hidden" />
    </div>
  );
}
```

- [ ] **Step 2: Implement `web/src/pages/CreatePage.tsx` (Sections A, B, C — form only, no submit yet)**

Replace the stub:

```tsx
import { useState, useRef } from 'react';
import ThumbnailPicker from '../components/ThumbnailPicker';

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
  // Section A: video
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ name: string; size: string; duration: string } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Section B: thumbnail
  const [thumbnailBytes, setThumbnailBytes] = useState<Uint8Array | null>(null);

  // Section C: metadata
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceInput, setPriceInput] = useState('');

  const section: Section =
    !videoFile ? 'A'
    : !thumbnailBytes ? 'B'
    : title.length < 1 || description.length < 1 || !priceInput || parseFloat(priceInput) <= 0 ? 'C'
    : 'D';

  const pricePlanck = priceInput ? BigInt(Math.round(parseFloat(priceInput) * 1e10)) : 0n;

  function handleFilePick(file: File) {
    setVideoError(null);
    setThumbnailBytes(null);

    const offscreen = document.createElement('video');
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

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFilePick(file);
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
              src={URL.createObjectURL(videoFile)}
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
          {/* Title */}
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

          {/* Description */}
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

          {/* Price */}
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

      {/* Section D placeholder (implemented in Task 11) */}
      {section === 'D' && (
        <p className="text-text-muted text-sm">Submit coming in Task 11…</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check + dev server**

```bash
cd web && npx tsc --noEmit
npm run dev
```

Navigate to `/create`. Verify:
- Video picker shows drag-drop zone; picking a video reveals metadata + inline player
- Thumbnail picker appears after a valid video is loaded; selecting a frame highlights it
- Metadata form appears after a thumbnail is selected; character counters work
- "Submit coming in Task 11…" placeholder appears when all fields are valid

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ThumbnailPicker.tsx web/src/pages/CreatePage.tsx
git commit -m "P1b: Create page progressive form — video picker, thumbnail picker, metadata (Sections A–C)"
```

---

## Task 11 — Create page: submit checklist + upload flow (Section D)

**Files:**
- Create: `web/src/components/CreateChecklist.tsx`
- Modify: `web/src/pages/CreatePage.tsx` (add Section D)

- [ ] **Step 1: Create `web/src/components/CreateChecklist.tsx`**

```tsx
export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface ChecklistStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;     // e.g. "42%"
  errorMsg?: string;
}

interface Props {
  steps: ChecklistStep[];
  onRetry?: (stepId: string) => void;
}

function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'done') return <span className="text-accent-green">✓</span>;
  if (status === 'error') return <span className="text-accent-red">✗</span>;
  if (status === 'running') {
    return (
      <span className="inline-block w-3 h-3 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
    );
  }
  return <span className="text-text-muted">·</span>;
}

export default function CreateChecklist({ steps, onRetry }: Props) {
  return (
    <ul className="flex flex-col gap-2">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 w-4 shrink-0 flex justify-center">
            <StatusIcon status={step.status} />
          </span>
          <span className={
            step.status === 'done' ? 'text-text-secondary'
            : step.status === 'error' ? 'text-accent-red'
            : step.status === 'running' ? 'text-text-primary'
            : 'text-text-muted'
          }>
            {step.label}
            {step.detail && <span className="text-text-muted ml-1">{step.detail}</span>}
            {step.status === 'error' && step.errorMsg && (
              <span className="block text-xs text-accent-red mt-0.5">{step.errorMsg}</span>
            )}
            {step.status === 'error' && onRetry && (
              <button
                onClick={() => onRetry(step.id)}
                className="ml-2 text-xs text-polka-400 hover:text-polka-300 underline"
              >
                Retry
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Add Section D to `web/src/pages/CreatePage.tsx`**

Add the following imports at the top of `CreatePage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import CreateChecklist, { type ChecklistStep, type StepStatus } from '../components/CreateChecklist';
import { uploadToBulletin } from '../hooks/useBulletinUpload';
import { submitCreateListing } from '../hooks/useContentRegistry';
import { getContentHash, HashAlgorithm } from '@parity/bulletin-sdk';
```

Add these state variables inside the component body, after the existing state:

```tsx
const navigate = useNavigate();
const [steps, setSteps] = useState<ChecklistStep[]>([]);
const [submitting, setSubmitting] = useState(false);
const [failedStep, setFailedStep] = useState<string | null>(null);
```

Add this helper inside the component:

```tsx
function setStep(id: string, status: StepStatus, detail?: string, errorMsg?: string) {
  setSteps((prev) =>
    prev.map((s) => (s.id === id ? { ...s, status, detail, errorMsg } : s)),
  );
}
```

Add the `handleSubmit` function inside the component:

```tsx
async function handleSubmit() {
  if (!videoFile || !thumbnailBytes || !title || !description || pricePlanck <= 0n) return;

  setSubmitting(true);
  setFailedStep(null);

  const initialSteps: ChecklistStep[] = [
    { id: 'cid',       label: 'Computing content CID…',          status: 'pending' },
    { id: 'auth',      label: 'Authorizing preimages on Bulletin…', status: 'pending' },
    { id: 'thumb',     label: 'Uploading thumbnail to Bulletin…', status: 'pending' },
    { id: 'content',   label: 'Uploading content to Bulletin…',  status: 'pending' },
    { id: 'sign',      label: 'Waiting for signature…',          status: 'pending' },
    { id: 'submit',    label: 'Submitting create_listing…',      status: 'pending' },
  ];
  setSteps(initialSteps);

  try {
    // Step: compute CID (offline)
    setStep('cid', 'running');
    const videoBytes = new Uint8Array(await videoFile.arrayBuffer());
    const contentHash = await getContentHash(videoBytes, HashAlgorithm.Blake2b256);
    setStep('cid', 'done');

    // Steps: auth + upload (thumbnail first, content second)
    setStep('auth', 'running');

    // Thumbnail upload (authorizePreimage happens inside uploadToBulletin)
    setStep('auth', 'done');
    setStep('thumb', 'running');
    const thumbnailCid = await uploadToBulletin(
      thumbnailBytes,
      (pct) => setStep('thumb', 'running', `${Math.round(pct)}%`),
    );
    setStep('thumb', 'done');

    // Content upload
    setStep('content', 'running');
    const contentCid = await uploadToBulletin(
      videoBytes,
      (pct) => setStep('content', 'running', `${Math.round(pct)}%`),
    );
    setStep('content', 'done');

    // Sign + submit create_listing
    setStep('sign', 'running');
    // signAndSubmit below will prompt the phone in Triangle mode;
    // setStep('submit', ...) fires right after the signature step inside submitCreateListing.
    setStep('submit', 'running');
    const newId = await submitCreateListing({
      contentCid,
      thumbnailCid,
      contentHash,
      title,
      description,
      price: pricePlanck,
    });
    setStep('sign', 'done');
    setStep('submit', 'done');

    navigate(`/listing/${newId}`);
  } catch (e) {
    // Find the first non-done step and mark it as error
    setSteps((prev) => {
      const idx = prev.findIndex((s) => s.status === 'running');
      if (idx < 0) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], status: 'error', errorMsg: String(e) };
      return updated;
    });
    setFailedStep(steps.find((s) => s.status === 'running')?.id ?? null);
    setSubmitting(false);
  }
}
```

Replace the Section D placeholder with:

```tsx
{section === 'D' && (
  <div className="flex flex-col gap-4">
    {steps.length === 0 ? (
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-2.5 rounded-lg bg-polka-500 hover:bg-polka-400 text-white text-sm
                   font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Create listing
      </button>
    ) : (
      <CreateChecklist
        steps={steps}
        onRetry={() => handleSubmit()}
      />
    )}
  </div>
)}
```

- [ ] **Step 3: TypeScript check + dev server**

```bash
cd web && npx tsc --noEmit
npm run dev
```

Navigate to `/create`, fill in all sections, verify that:
- The "Create listing" button appears in Section D when all fields are valid
- Clicking it shows the checklist with steps progressing
- (Full end-to-end requires Zombienet + Paseo Bulletin — tested in Task 13)

- [ ] **Step 4: Commit**

```bash
git add web/src/components/CreateChecklist.tsx web/src/pages/CreatePage.tsx
git commit -m "P1b: Create page Section D — submit checklist, upload flow, create_listing submission"
```

---

## Task 12 — My Purchases page

**Files:**
- Modify: `web/src/pages/PurchasesPage.tsx` (replace stub)

- [ ] **Step 1: Implement `web/src/pages/PurchasesPage.tsx`**

Replace the stub:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import {
  fetchPurchases,
  fetchListing,
  type Listing,
} from '../hooks/useContentRegistry';
import ListingCard from '../components/ListingCard';
import SkeletonCard from '../components/SkeletonCard';

export default function PurchasesPage() {
  const account = useChainStore((s) => s.account);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) {
      setListings([]);
      return;
    }

    fetchPurchases(account)
      .then(async (purchases) => {
        const resolved = await Promise.all(
          purchases.map((p) => fetchListing(p.listingId)),
        );
        setListings(resolved.filter((l): l is Listing => l !== undefined));
      })
      .catch((e) => setError(String(e)));
  }, [account]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">My Purchases</h1>
        {listings !== null && (
          <span className="text-sm text-text-muted">
            {listings.length} purchased
          </span>
        )}
      </div>

      {/* Error */}
      {error && <p className="text-accent-red text-sm">{error}</p>}

      {/* Loading skeleton */}
      {listings === null && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* Empty state */}
      {listings !== null && listings.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-text-secondary">You haven't bought anything yet.</p>
          <Link to="/" className="text-polka-400 hover:text-polka-300 text-sm">
            Browse listings
          </Link>
        </div>
      )}

      {/* Grid */}
      {listings !== null && listings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((l) => <ListingCard key={String(l.id)} listing={l} />)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check + dev server**

```bash
cd web && npx tsc --noEmit
npm run dev
```

Navigate to `/purchases`. Verify:
- Skeleton grid shows while loading
- Empty state appears when the account has no purchases
- (Populated state requires a purchased listing — tested in Task 13)

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/PurchasesPage.tsx
git commit -m "P1b: My Purchases page — prefix-scan Purchases, parallel listing fetch, skeleton + empty state"
```

---

## Task 13 — Spec §5.1 + §6 — two-signer account model

Document the two-signer model in the canonical spec before touching code: Alice signs Bulletin `authorize_account` only; the user account signs every parachain extrinsic and Bulletin `store()`. §5.1 steps 4–6 are rewritten to match the working Paseo Bulletin reality (signed `store()`, not the broken preimage-unsigned path). §6 gets an explicit "Signers" bullet and notes the dev-mode Bob pin.

**Files:**
- Modify: `docs/design/spec.md` §5.1 steps 4–6
- Modify: `docs/design/spec.md` §6 "Account model" bullet; add "Signers" bullet

- [ ] **Step 1: Rewrite §5.1 step 4 — drop the `authorize_preimage` reference**

Replace the trailing clause "the digests alone feed `authorize_preimage`" with a simple period; digests no longer feed an authorization call under the new model.

- [ ] **Step 2: Rewrite §5.1 step 5 — switch to `authorize_account` signed by Alice**

```markdown
5. Ensure the user account has Bulletin Chain authorization by submitting `authorize_account(userAddress, txCount, bytes)`, signed by `//Alice`. On Paseo testnet, `Alice` is in the `TransactionStorage::Authorizer` origin's `TestAccounts` set and is the sanctioned signer for authorize calls — no user signature or fee. The authorization grants the connected user account a per-session quota (default 10 transactions / 100 MiB) for signing `store()` directly. Before every upload the frontend queries the user's remaining authorization on-chain and only calls `authorize_account` when the remaining quota is insufficient for the upload at hand; there is no in-memory cache. (Mainnet Bulletin is not yet deployed; out of scope.) `scripts/verify-bulletin-faucet.ts` exercises the preimage-authorization variant against `wss://paseo-bulletin-rpc.polkadot.io`; account-authorization is exercised by the frontend's upload flow.
```

- [ ] **Step 3: Rewrite §5.1 step 6 — signed `store()` by the user**

```markdown
6. Submit two signed `store()` calls via `@parity/bulletin-sdk` — one for the thumbnail, one for the content — each signed by the **user** account (not Alice). The prior `authorize_account` grant gates the writes. Phase 1 caps each upload at the SDK's 2 MiB single-tx threshold; Paseo Bulletin's chunked path is unstable under load (per-chunk blake2b-256 + DAG-PB manifest construction), so the chunked code path is deliberately avoided until the SDK issue is resolved. The thumbnail is always stored unencrypted (even in Phase 2) so the browse grid can render without keys.
```

- [ ] **Step 4: Extend §6 "Account model" bullet with the dev pin note**

Append to the existing "Account model" bullet: "In local dev (Zombienet), the frontend pins a fixed non-Alice dev account (Bob by default) as the user so the two-signer flow is exercised end-to-end; no account switcher is exposed — revisit post-Phase 1c once host-mode deployment has been demoed."

- [ ] **Step 5: Insert a new §6 "Signers" bullet directly after "Account model"**

```markdown
- **Signers.** The frontend holds two distinct signers. A **user signer** (Triangle-provided in host mode, dev-derived in local mode) signs every parachain extrinsic (`create_listing`, `purchase`, `register_encryption_key`, batch wrappers) and the Bulletin `store()` call. An **Alice signer** (derived in-browser from `//Alice` via `sr25519CreateDerive`) is used **only** to sign Bulletin `authorize_account` calls, since Alice is in Paseo Bulletin's `TestAccounts` set for the `Authorizer` origin. Alice never signs parachain extrinsics; the user signer never signs Bulletin authorization calls.
```

- [ ] **Step 6: Commit**

```bash
git add docs/design/spec.md
git commit -m "docs(spec): two-signer account model — Alice for Bulletin auth, user for everything else"
```

---

## Task 14 — Dev accounts: pin one user account, expose Alice separately (TDD)

Extend the dev-account module so Alice is no longer implicitly "the user". Export an explicit `DEV_USER_INDEX` that points at Bob (the dev-mode user), and a narrow `getAliceSigner()` helper used only by the Bulletin authorization path. These exports are the seam the provider and upload hooks depend on in later tasks.

**Files:**
- Create: `web/src/hooks/useAccount.test.ts`
- Modify: `web/src/hooks/useAccount.ts`

- [ ] **Step 1: Write the failing tests**

`web/src/hooks/useAccount.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import { devAccounts, aliceAccount, DEV_USER_INDEX, getAliceSigner } from './useAccount';

describe('account exports', () => {
  test('DEV_USER_INDEX points at Bob, not Alice', () => {
    expect(DEV_USER_INDEX).toBe(1);
    expect(devAccounts[DEV_USER_INDEX].name).toBe('Bob');
  });

  test('aliceAccount is devAccounts[0]', () => {
    expect(aliceAccount.name).toBe('Alice');
    expect(aliceAccount.address).toBe(devAccounts[0].address);
  });

  test('getAliceSigner returns Alice\'s PAPI signer', () => {
    expect(getAliceSigner()).toBe(devAccounts[0].signer);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `cd web && npx vitest run src/hooks/useAccount.test.ts`
Expected: `aliceAccount`, `DEV_USER_INDEX`, `getAliceSigner` not exported.

- [ ] **Step 3: Add the exports**

Append to `web/src/hooks/useAccount.ts`:

```typescript
/**
 * Dev-mode: which entry in `devAccounts` acts as the connected user account.
 *
 * NOT Alice. Alice is reserved for Bulletin Chain authorization extrinsics
 * (see `getAliceSigner`), so using a different account as the user exercises
 * the two-signer flow end-to-end against Zombienet.
 */
export const DEV_USER_INDEX = 1;

/** Alice is always devAccounts[0] — the canonical Bulletin authorization signer. */
export const aliceAccount = devAccounts[0];

/**
 * Returns Alice's PAPI signer. Use ONLY for Bulletin `authorize_account`
 * / `authorize_preimage`. Never use to sign parachain extrinsics.
 */
export function getAliceSigner(): PolkadotSigner {
  return aliceAccount.signer;
}
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `cd web && npx vitest run src/hooks/useAccount.test.ts`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/hooks/useAccount.ts web/src/hooks/useAccount.test.ts
git commit -m "P1b: dev accounts — pin user index, expose Alice signer separately (TDD)"
```

---

## Task 15 — Split parachain provider into user + Alice signers (TDD)

Replace the single `_currentSigner` global with explicit `getUserSigner()` and `getUserAddress()` (Triangle-sourced in host mode, Bob in dev) plus a passthrough `getAliceSigner()`. Wire callers through `getUserSigner()` — `useContentRegistry.ts` is the only caller today. Add a subscription seam (`subscribeUserAccount`) for future host-mode account-change events; it is synchronously invoked once at subscribe time so components can treat it like a state selector.

**Files:**
- Modify: `web/src/hooks/useParachainProvider.ts`
- Modify: `web/src/hooks/useParachainProvider.test.ts`
- Modify: `web/src/hooks/useContentRegistry.ts`

- [ ] **Step 1: Rewrite the failing tests**

Replace `web/src/hooks/useParachainProvider.test.ts` with:

```typescript
import { describe, test, expect } from 'vitest';
import {
  getParachainApi,
  getUserSigner,
  getUserAddress,
  getAliceSigner,
} from './useParachainProvider';
import { aliceAccount } from './useAccount';

describe('getParachainApi', () => {
  test('throws before provider is initialized', () => {
    expect(() => getParachainApi()).toThrowError('Parachain provider not initialized');
  });
});

describe('getUserSigner', () => {
  test('throws before provider is initialized', () => {
    expect(() => getUserSigner()).toThrowError('No user signer — provider not initialized');
  });
});

describe('getUserAddress', () => {
  test('returns null before provider is initialized', () => {
    expect(getUserAddress()).toBeNull();
  });
});

describe('getAliceSigner', () => {
  test('returns Alice signer synchronously, without provider init', () => {
    expect(getAliceSigner()).toBe(aliceAccount.signer);
  });
});
```

- [ ] **Step 2: Run the test — expect FAIL**

Run: `cd web && npx vitest run src/hooks/useParachainProvider.test.ts`
Expected: `getUserSigner` / `getUserAddress` / `getAliceSigner` not exported.

- [ ] **Step 3: Rewrite `useParachainProvider.ts`**

Full replacement of `web/src/hooks/useParachainProvider.ts`:

```typescript
import { createClient, AccountId, type PolkadotClient, type PolkadotSigner, type TypedApi } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import {
  sandboxProvider,
  sandboxTransport,
  createPapiProvider,
  createAccountsProvider,
  hostApi,
} from '@novasamatech/product-sdk';
import { enumValue } from '@novasamatech/host-api';
import { ppview } from '@polkadot-api/descriptors';
import { useEffect } from 'react';
import { useChainStore } from '../store/chainStore';
import { devAccounts, DEV_USER_INDEX, getAliceSigner as getAliceSignerFromAccount } from './useAccount';

const PPVIEW_GENESIS = '0x4545454545454545454545454545454545454545454545454545454545454545';
const DEV_WS = 'ws://127.0.0.1:9944';
const SS58_PREFIX = 42;

const addressCodec = AccountId(SS58_PREFIX);

type ParachainApi = TypedApi<typeof ppview>;

let _parachainClient: PolkadotClient | null = null;
let _parachainApi: ParachainApi | null = null;
let _userSigner: PolkadotSigner | null = null;
let _userAddress: string | null = null;

type AccountSubscriber = (address: string | null) => void;
const _accountSubscribers = new Set<AccountSubscriber>();

export function getParachainApi(): ParachainApi {
  if (!_parachainApi) throw new Error('Parachain provider not initialized');
  return _parachainApi;
}

export function getUserSigner(): PolkadotSigner {
  if (!_userSigner) throw new Error('No user signer — provider not initialized');
  return _userSigner;
}

export function getUserAddress(): string | null {
  return _userAddress;
}

export function getAliceSigner(): PolkadotSigner {
  return getAliceSignerFromAccount();
}

export function subscribeUserAccount(cb: AccountSubscriber): () => void {
  _accountSubscribers.add(cb);
  cb(_userAddress);
  return () => {
    _accountSubscribers.delete(cb);
  };
}

function setUserAccount(address: string | null, signer: PolkadotSigner | null): void {
  _userAddress = address;
  _userSigner = signer;
  for (const sub of _accountSubscribers) sub(address);
}

async function initProvider(): Promise<{ address: string | null }> {
  const inHost = sandboxProvider.isCorrectEnvironment();

  if (inHost) {
    await hostApi
      .permission(enumValue('v1', { tag: 'TransactionSubmit', value: undefined }))
      .match(
        () => {},
        (err: unknown) => console.warn('Transaction permission denied:', err),
      );

    const papiProvider = createPapiProvider(PPVIEW_GENESIS);
    _parachainClient = createClient(papiProvider);
    _parachainApi = _parachainClient.getTypedApi(ppview);

    const accountsProvider = createAccountsProvider(sandboxTransport);
    const res = await accountsProvider.getNonProductAccounts();
    const acct = res.match(
      (accts: { publicKey: Uint8Array; name?: string }[]) => accts[0] ?? null,
      () => null,
    );

    if (acct) {
      const address = addressCodec.dec(acct.publicKey);
      setUserAccount(address, accountsProvider.getNonProductAccountSigner(acct as any));
      return { address };
    }
    setUserAccount(null, null);
    return { address: null };
  } else {
    _parachainClient = createClient(withPolkadotSdkCompat(getWsProvider(DEV_WS)));
    _parachainApi = _parachainClient.getTypedApi(ppview);
    const user = devAccounts[DEV_USER_INDEX];
    setUserAccount(user.address, user.signer);
    return { address: user.address };
  }
}

/**
 * Mount once in App. Initializes the PAPI client, selects the user account,
 * and subscribes to balance updates.
 */
export function useParachainProvider() {
  const setAccount = useChainStore((s) => s.setAccount);
  const setBalance = useChainStore((s) => s.setBalance);
  const setConnected = useChainStore((s) => s.setConnected);

  useEffect(() => {
    let balanceSub: { unsubscribe: () => void } | null = null;
    let cancelled = false;

    initProvider()
      .then(({ address }) => {
        if (cancelled) return;
        setAccount(address);
        setConnected(true);

        if (address && _parachainApi) {
          balanceSub = _parachainApi.query.System.Account.watchValue(address).subscribe({
            next: (info: { data: { free: bigint } }) => setBalance(info.data.free),
            error: (err: unknown) => console.error('Balance subscription error:', err),
          });
        }
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      balanceSub?.unsubscribe();
    };
  }, [setAccount, setBalance, setConnected]);
}
```

- [ ] **Step 4: Update `useContentRegistry.ts` callers**

In `web/src/hooks/useContentRegistry.ts:2`, change the import from `getCurrentSigner` to `getUserSigner`:

```typescript
import { getParachainApi, getUserSigner } from './useParachainProvider';
```

Replace both `getCurrentSigner()` call sites (around lines 96 and 123) with `getUserSigner()`. No other shape changes.

- [ ] **Step 5: Run the hooks test suite — expect PASS**

Run: `cd web && npx vitest run src/hooks/`
Expected: `useAccount`, `useParachainProvider`, `useContentRegistry`, `useBulletinUpload` tests all pass. (`useBulletinUpload` still uses the old single-signer path; will be replaced in Task 16.)

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useParachainProvider.ts web/src/hooks/useParachainProvider.test.ts web/src/hooks/useContentRegistry.ts
git commit -m "P1b: split parachain provider — user signer + separate Alice signer (TDD)"
```

---

## Task 16 — Bulletin upload: Alice signs authorization, user signs store (TDD)

Replace the single Alice-signed upload with a two-client flow: an Alice-bound `AsyncBulletinClient` for `authorize_account`, and a user-bound one for `store()`. Before each upload the hook queries on-chain authorization for the user address via PAPI and only calls `authorize_account` when remaining quota is insufficient for the upload at hand. No in-memory cache — idempotency comes from the on-chain check alone, so browser refreshes, multiple tabs, and multi-session use all stay correct without bookkeeping. Also lower the upload cap from 20 MiB to 2 MiB to match the existing chunked-SIGILL workaround.

**Files:**
- Modify: `web/src/hooks/useBulletinUpload.ts`
- Modify: `web/src/hooks/useBulletinUpload.test.ts`

- [ ] **Step 1: Research — identify the Bulletin authorization storage item**

Run: `cd web && grep -rE 'Authoriz(ation|ations|eAccount)' node_modules/@polkadot-api/descriptors/dist/index.d.ts | head -40`

Record the exact storage path under `TransactionStorage` that holds per-account authorization (keyed by AccountId). Common shapes are `TransactionStorage.Authorizations` (map → `{ transactions, bytes }`) or `TransactionStorage.ByteFee` + a separate per-account authorization counter. You only need two fields: remaining tx count and remaining byte capacity. Record the exact member names (camelCase/snake_case) because the rest of the task references them.

If the descriptor shape differs from `{ transactions, bytes }`, update both the production `getRemainingAuthorization` helper in Step 4 and the tests in Step 2 to match. Everything else in the task is insensitive to the exact shape.

- [ ] **Step 2: Rewrite the failing tests**

Replace `web/src/hooks/useBulletinUpload.test.ts` with:

```typescript
import { describe, test, expect, vi, afterEach } from 'vitest';
import { MockBulletinClient } from '@parity/bulletin-sdk';

import { fetchFromIpfs, uploadToBulletin } from './useBulletinUpload';
import type { BulletinCidFields } from './useContentRegistry';

// ── fetchFromIpfs (unchanged) ─────────────────────────────────────────────────

describe('fetchFromIpfs', () => {
  afterEach(() => vi.restoreAllMocks());

  test('returns Uint8Array on a successful fetch', async () => {
    const data = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(data.buffer),
    }));

    const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xab) };
    const result = await fetchFromIpfs(cid);
    expect(result).toEqual(data);
  });

  test('requests the Paseo IPFS gateway URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });
    vi.stubGlobal('fetch', fetchMock);

    const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xab) };
    await fetchFromIpfs(cid);

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/paseo-ipfs\.polkadot\.io\/ipfs\//);
  });

  test('throws on a non-ok HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    }));

    const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32).fill(0x01) };
    await expect(fetchFromIpfs(cid)).rejects.toThrow('404');
  });
});

// ── uploadToBulletin — two-signer flow with on-chain quota check ──────────────

type QuotaFn = (address: string) => Promise<{ transactions: number; bytes: bigint } | null>;

function makeCtx(partial: {
  aliceClient?: MockBulletinClient;
  userClient?: MockBulletinClient;
  userAddress?: string;
  getRemainingAuthorization?: QuotaFn;
}) {
  return {
    aliceClient: partial.aliceClient ?? new MockBulletinClient(),
    userClient: partial.userClient ?? new MockBulletinClient(),
    userAddress: partial.userAddress ?? '5Bob',
    getRemainingAuthorization: partial.getRemainingAuthorization ?? (async () => null),
  };
}

describe('uploadToBulletin', () => {
  test('returns BulletinCidFields with codec and digestBytes from the store result', async () => {
    const ctx = makeCtx({});
    const bytes = new Uint8Array(64).fill(0xff);

    const cid = await uploadToBulletin(bytes, undefined, ctx);

    expect(typeof cid.codec).toBe('number');
    expect(cid.digestBytes).toBeInstanceOf(Uint8Array);
    expect(cid.digestBytes.length).toBeGreaterThan(0);
  });

  test('when user has no authorization, Alice authorizes and user stores', async () => {
    const ctx = makeCtx({ getRemainingAuthorization: async () => null });
    const bytes = new Uint8Array(64).fill(0xaa);

    await uploadToBulletin(bytes, undefined, ctx);

    const aliceOps = ctx.aliceClient.getOperations();
    const userOps = ctx.userClient.getOperations();

    expect(aliceOps.some((op) => op.type === 'authorize_account' && op.who === '5Bob')).toBe(true);
    expect(userOps.some((op) => op.type === 'store')).toBe(true);
    // User must never sign an authorization extrinsic.
    expect(userOps.every((op) => op.type !== 'authorize_account')).toBe(true);
    expect(userOps.every((op) => op.type !== 'authorize_preimage')).toBe(true);
    // Alice must never sign a store extrinsic.
    expect(aliceOps.every((op) => op.type !== 'store')).toBe(true);
  });

  test('when user quota is sufficient, skip authorize_account entirely', async () => {
    const ctx = makeCtx({
      getRemainingAuthorization: async () => ({
        transactions: 5,
        bytes: 50n * 1024n * 1024n,
      }),
    });
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, undefined, ctx);

    const aliceOps = ctx.aliceClient.getOperations();
    expect(aliceOps.length).toBe(0);

    const userOps = ctx.userClient.getOperations();
    expect(userOps.some((op) => op.type === 'store')).toBe(true);
  });

  test('when user quota is too small for this upload, re-authorize', async () => {
    const ctx = makeCtx({
      getRemainingAuthorization: async () => ({
        transactions: 0,
        bytes: 0n,
      }),
    });
    const bytes = new Uint8Array(64).fill(0x02);

    await uploadToBulletin(bytes, undefined, ctx);

    const aliceOps = ctx.aliceClient.getOperations();
    expect(aliceOps.some((op) => op.type === 'authorize_account')).toBe(true);
  });

  test('calls onProgress with values between 0 and 100', async () => {
    const ctx = makeCtx({});
    const progresses: number[] = [];
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, (pct) => progresses.push(pct), ctx);

    expect(progresses.length).toBeGreaterThan(0);
    for (const p of progresses) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  test('rejects files larger than 2 MiB before touching the chain', async () => {
    const ctx = makeCtx({});
    const bytes = new Uint8Array(2 * 1024 * 1024 + 1);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow(/2 MiB/i);

    expect(ctx.aliceClient.getOperations()).toEqual([]);
    expect(ctx.userClient.getOperations()).toEqual([]);
  });

  test('throws when storage fails', async () => {
    const userClient = new MockBulletinClient({ simulateStorageFailure: true });
    const ctx = makeCtx({ userClient });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow();
  });

  test('propagates authorization failure without calling store', async () => {
    const aliceClient = new MockBulletinClient({ simulateStorageFailure: true });
    const ctx = makeCtx({ aliceClient });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(uploadToBulletin(bytes, undefined, ctx)).rejects.toThrow();

    expect(ctx.userClient.getOperations().some((op) => op.type === 'store')).toBe(false);
  });
});
```

> **Note on MockBulletinClient op shape:** `@parity/bulletin-sdk` ships a `MockBulletinClient` that records `authorize_account` / `store` calls. If `getOperations()` emits a different `type` string (e.g. `'authorize'` rather than `'authorize_account'`), adjust the three relevant assertions to match — run step 3 below once before writing the production code to confirm the exact string.

- [ ] **Step 3: Inspect `MockBulletinClient.getOperations()` shape**

Run: `cd web && node -e "const m=require('@parity/bulletin-sdk'); const c=new m.MockBulletinClient(); c.authorizeAccount('5Bob', 10, 100n).send().then(()=>console.log(JSON.stringify(c.getOperations())))"`

If the emitted `type` isn't `'authorize_account'`, fix the test assertions before proceeding. The production code is insensitive to the mock's type string.

- [ ] **Step 4: Rewrite `useBulletinUpload.ts`**

Replace the full contents of `web/src/hooks/useBulletinUpload.ts` with:

```typescript
import { createClient, type PolkadotClient, type PolkadotSigner } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import {
	AsyncBulletinClient,
	ChunkStatus,
	type BulletinClientInterface,
	type ProgressCallback,
} from "@parity/bulletin-sdk";
import { bulletin } from "@polkadot-api/descriptors";
import { getAliceSigner, getUserSigner, getUserAddress } from "./useParachainProvider";
import { bulletinCidToGatewayUrl } from "../utils/bulletinCid";
import type { BulletinCidFields } from "./useContentRegistry";

const BULLETIN_WS = "wss://paseo-bulletin-rpc.polkadot.io";

// Phase 1 PoC cap — chunked path is unstable on Paseo Bulletin, so keep every
// upload under the SDK's 2 MiB single-tx threshold.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

// Quota issued by Alice when re-authorizing the user.
export const AUTH_TX_COUNT = 10;
export const AUTH_BYTES = 100n * 1024n * 1024n;

let _bulletinPapiClient: PolkadotClient | null = null;
let _aliceClient: AsyncBulletinClient | null = null;
let _userClient: AsyncBulletinClient | null = null;

function getPapiClient(): PolkadotClient {
	if (!_bulletinPapiClient) {
		_bulletinPapiClient = createClient(withPolkadotSdkCompat(getWsProvider(BULLETIN_WS)));
	}
	return _bulletinPapiClient;
}

function buildClient(signer: PolkadotSigner): AsyncBulletinClient {
	const papi = getPapiClient();
	const api = papi.getTypedApi(bulletin);
	return new AsyncBulletinClient(api, signer, (papi as any).submit);
}

function getAliceClient(): AsyncBulletinClient {
	if (!_aliceClient) _aliceClient = buildClient(getAliceSigner());
	return _aliceClient;
}

function getUserClient(): AsyncBulletinClient {
	if (!_userClient) _userClient = buildClient(getUserSigner());
	return _userClient;
}

export interface RemainingAuthorization {
	transactions: number;
	bytes: bigint;
}

/**
 * Query Bulletin's authorization storage for the given account.
 * Returns null when the account has no authorization record.
 *
 * NOTE (implementation): confirm the exact descriptor path in Task 16 Step 1.
 * Adjust this function's storage call + field names to match.
 */
export async function getRemainingAuthorization(
	address: string,
): Promise<RemainingAuthorization | null> {
	const api = getPapiClient().getTypedApi(bulletin);
	const entry = await api.query.TransactionStorage.Authorizations.getValue(address);
	if (!entry) return null;
	return { transactions: entry.transactions, bytes: entry.bytes };
}

export interface UploadContext {
	aliceClient?: BulletinClientInterface;
	userClient?: BulletinClientInterface;
	userAddress?: string;
	getRemainingAuthorization?: (address: string) => Promise<RemainingAuthorization | null>;
}

async function ensureAuthorization(
	aliceClient: BulletinClientInterface,
	userAddress: string,
	uploadBytes: number,
	getQuota: (address: string) => Promise<RemainingAuthorization | null>,
): Promise<void> {
	const quota = await getQuota(userAddress);
	if (quota && quota.transactions >= 1 && quota.bytes >= BigInt(uploadBytes)) return;
	await aliceClient.authorizeAccount(userAddress, AUTH_TX_COUNT, AUTH_BYTES).send();
}

/**
 * Upload bytes to Bulletin Chain.
 *
 * Two-signer flow:
 *   1. Query on-chain authorization for the user account.
 *      If insufficient quota for this upload, Alice signs
 *      `authorize_account(userAddress, AUTH_TX_COUNT, AUTH_BYTES)`.
 *   2. The user signs `store()` for the content.
 *
 * Idempotency comes from the on-chain check — there is no in-memory cache,
 * so browser refreshes, multiple tabs, and new sessions all behave correctly
 * without bookkeeping.
 */
export async function uploadToBulletin(
	bytes: Uint8Array,
	onProgress?: (pct: number) => void,
	ctx?: UploadContext,
): Promise<BulletinCidFields> {
	if (bytes.length > MAX_UPLOAD_BYTES) {
		throw new Error(
			`File is too large: ${bytes.length} bytes. Phase 1 PoC supports up to 2 MiB per upload.`,
		);
	}

	const aliceClient = ctx?.aliceClient ?? getAliceClient();
	const userClient = ctx?.userClient ?? getUserClient();
	const userAddress = ctx?.userAddress ?? getUserAddress();
	const getQuota = ctx?.getRemainingAuthorization ?? getRemainingAuthorization;
	if (!userAddress) throw new Error("No connected user account for Bulletin upload");

	await ensureAuthorization(aliceClient, userAddress, bytes.length, getQuota);

	const progressCb: ProgressCallback = (event) => {
		if (event.type === ChunkStatus.ChunkCompleted) {
			onProgress?.(((event.index + 1) / event.total) * 100);
		}
	};

	const result = await userClient.store(bytes).withCallback(progressCb).send();

	onProgress?.(100);

	if (!result.cid) throw new Error("Bulletin upload returned no CID");

	return {
		codec: result.cid.code,
		digestBytes: new Uint8Array(result.cid.multihash.digest),
	};
}

/**
 * Fetch raw bytes from the Paseo IPFS gateway.
 * Throws on HTTP error or network failure.
 */
export async function fetchFromIpfs(cid: BulletinCidFields): Promise<Uint8Array> {
	const url = bulletinCidToGatewayUrl(cid.codec, cid.digestBytes);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status} ${res.statusText}`);
	return new Uint8Array(await res.arrayBuffer());
}
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `cd web && npx vitest run src/hooks/useBulletinUpload.test.ts`
Expected: all tests pass. If the mock's op-type string differs from `'authorize_account'`, update the test assertions to match (not the source).

- [ ] **Step 6: Run the full frontend test suite — expect PASS**

Run: `cd web && npx vitest run`
Expected: every test passes.

- [ ] **Step 7: Commit**

```bash
git add web/src/hooks/useBulletinUpload.ts web/src/hooks/useBulletinUpload.test.ts
git commit -m "P1b: Bulletin upload — Alice signs authorization, user signs store (TDD)"
```

---

## Task 17 — Top-bar empty-state copy for host-mode pairing prompt

Match the host-api-example's empty state so host-mode users without a paired account see the correct prompt. Dev mode is unaffected (Bob is pinned synchronously at provider init, so the empty state never appears in dev).

**Files:**
- Modify: `web/src/App.tsx:72`

- [ ] **Step 1: Update the empty-state label**

Change the fallback span:

```tsx
<span className="text-xs text-text-muted">No account</span>
```

to:

```tsx
<span className="text-xs text-text-muted">Pair your Polkadot App to get started</span>
```

- [ ] **Step 2: Manual sanity check**

Start the dev server (`cd web && npm run dev`). With Zombienet up, the top-bar should show Bob's truncated address + balance. Without Zombienet, the top-bar should still render (connection pending) and eventually either show the Bob fallback or stay on the pairing prompt — in dev mode it should never be stuck on the pairing prompt, since Bob is derived synchronously from `devAccounts`.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "P1b: top-bar empty-state copy — pairing prompt for host mode"
```

---

## Task 18 — E2E verification: user signs parachain + store, Alice signs only authorization

No code changes — in-browser verification against Zombienet and Paseo Bulletin confirming the two-signer split holds end-to-end.

**Files:** none modified — verification only.

- [ ] **Step 1: Start Zombienet**

```bash
./scripts/start-local.sh
```

Wait for the parachain to produce blocks.

- [ ] **Step 2: Start the frontend**

```bash
cd web && npm run dev
```

- [ ] **Step 3: Confirm the user is Bob**

Open `http://localhost:5173`. Top-bar shows Bob's truncated address + balance — **not** Alice's. If Alice's address appears, `DEV_USER_INDEX` or the provider hasn't been wired correctly.

- [ ] **Step 4: Fund Bob if balance is zero**

Navigate to the Accounts page and run the sudo funding flow (sudo is still Alice-signed — that's intentional, unrelated to the two-signer flow).

- [ ] **Step 5: Create a listing**

On `/create`, upload a small file (≤2 MiB) with a thumbnail. Watch the browser console + Paseo Bulletin explorer and confirm:
- Alice's address signs exactly one `authorize_account(Bob, 10, 100 MiB)` — or zero, if Bob already had sufficient on-chain quota from a prior run.
- Bob's address signs every `store()` call (two per listing: thumbnail + content).
- Bob's address signs `create_listing` on the parachain.

- [ ] **Step 6: Re-upload to confirm quota-check skips authorization**

Immediately create a second listing with a different small file. This time the on-chain quota check should find enough remaining authorization, so Alice signs **zero** `authorize_account` calls. Bob still signs both `store()` calls and `create_listing`.

- [ ] **Step 7: Purchase a listing**

Temporarily change `DEV_USER_INDEX = 2` (Charlie) in `web/src/hooks/useAccount.ts`, reload, fund Charlie if needed, navigate to a Bob-created listing, and purchase. Confirm Charlie's address signs `purchase` on the parachain.

- [ ] **Step 8: Revert the `DEV_USER_INDEX` override**

Restore `DEV_USER_INDEX = 1` before committing anything else.

- [ ] **Step 9: Report results**

Summarize to the user: what was tested, which account signed which extrinsic (per the explorer), anything unexpected. Ask for `[x]` validation before flipping progress.md.

---

## Task 19 — Full TypeScript check + dev-server smoke test against Zombienet

End-to-end golden-path test: Create a listing, purchase it, view it.

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

```bash
cd web && npm test
```

Expected: all 7 utility tests pass.

- [ ] **Step 2: Full TypeScript check**

```bash
cd web && npx tsc --noEmit
```

Expected: zero errors across all new files.

- [ ] **Step 3: Start Zombienet**

```bash
# From repo root in a separate terminal:
./scripts/start-local.sh
```

Wait for the parachain to produce blocks.

- [ ] **Step 4: Start the dev server**

```bash
cd web && npm run dev
```

Open `http://localhost:5173`.

- [ ] **Step 5: Smoke test — Create a listing**

1. Navigate to `/create`
2. Pick a small MP4 file (under 2 MiB for simplest flow)
3. Select a thumbnail frame
4. Fill in title, description, price (e.g. `1.0`)
5. Click "Create listing"
6. Watch the checklist progress through all steps
7. Expect redirect to `/listing/<new_id>`
8. Expect the listing detail page to show state 1 (thumbnail + lock — Alice is the creator; in dev mode, we create as Alice and the "Your listing" badge should appear)

Expected final state: listing detail shows `✓ Purchased` / `Your listing` badge (creator view) and the VideoPlayer loads the content.

- [ ] **Step 6: Smoke test — Browse**

Navigate to `/`. The new listing card appears in the grid.

- [ ] **Step 7: Smoke test — Purchase as Bob**

The dev mode uses Alice for all operations. To test the buy flow, temporarily change `devAccounts[0]` to `devAccounts[1]` (Bob) in `useParachainProvider.ts` (local-only, do not commit), reload, navigate to the listing, and click Buy.

Expected: Buy button transitions through "Waiting for signature…", then listing detail switches to state 2 (VideoPlayer + `✓ Purchased`).

- [ ] **Step 8: Smoke test — My Purchases**

As Bob (with the temporary override), navigate to `/purchases`. The purchased listing card appears.

- [ ] **Step 9: Revert the temporary Bob override if applied**

Ensure `devAccounts[0]` (Alice) is the default in `useParachainProvider.ts` before committing.

- [ ] **Step 10: Commit if any fixes were made during smoke testing**

If smoke testing revealed any bugs and they were fixed:

```bash
git add -p   # stage only the fix
git commit -m "P1b: fix <description of bug found in smoke test>"
```

---

## Done

After Task 19 the P1b deliverable is complete:

- All four views (Browse, Listing Detail, Create, My Purchases) render correctly
- Triangle host detection gates provider setup; dev mode pins Bob as the user and derives Alice in-browser for Bulletin authorization
- Content uploads to Paseo Bulletin Chain via `@parity/bulletin-sdk` with two signers — Alice signs `authorize_account` (only when on-chain quota is insufficient); Bob signs `store()`
- Listing detail verifies content integrity with blake2b-256 before rendering the player
- No Phase 2 functionality (no encryption, no `register_encryption_key`, no `batch_all`)
- Utility + hook tests pass; TypeScript compiles clean across all new files

Next: P1c (IPFS + DotNS deploy).

---

## Self-review

**Spec / frontend-views.md coverage:**

| Requirement | Covered in |
|---|---|
| Global chrome — app name, Browse/My Purchases/Create nav, account pill | Task 4 (App.tsx) |
| Account pill — truncated address + balance | Task 4 (App.tsx) |
| Browse grid — thumbnail, title, creator, price; skeleton; empty state | Tasks 7 |
| Listing Detail state 1 — thumbnail + lock overlay + Buy + balance check | Task 9 |
| Listing Detail state 2 — video player + blake2b integrity check | Tasks 8, 9 |
| Listing Detail Phase 1 creator view — state 2 + `Your listing` badge | Task 9 |
| Listing Detail 404 — "Listing not found" | Task 9 |
| Create — video picker (drag-drop + choose file + inline preview) | Task 10 |
| Create — thumbnail picker (3 frames via canvas) | Task 10 |
| Create — metadata form (title 128B, description 2048B, price > 0, planck display) | Task 10 |
| Create — submit checklist (6 steps, retry on failure) | Task 11 |
| Create — success redirects to `/listing/:new_id` | Task 11 |
| My Purchases — grid sorted by purchase time desc, skeleton, empty state | Task 12 |
| 404 route | Task 4 |
| `locked_content_lock_key` always empty in Phase 1 | Task 5 (`submitCreateListing`) |
| Bulletin uploads use `@parity/bulletin-sdk` | Tasks 6, 16 |
| IPFS reads via public gateway | Task 6 (`fetchFromIpfs`) |
| Spec §5.1 / §6 — two-signer account model | Task 13 |
| Dev accounts expose Alice separately + pin a non-Alice user | Task 14 |
| Provider splits user signer from Alice signer | Task 15 |
| Bulletin upload: Alice authorizes, user stores, on-chain quota check | Task 16 |
| Top-bar empty-state: "Pair your Polkadot App to get started" | Task 17 |
| E2E verification of the two-signer flow on Zombienet | Task 18 |

**Phase 2 items explicitly deferred:** states 3 and 4, `register_encryption_key`, `batch_all`, `WrappedKeys`, x25519 keypair generation, `createLocalStorage` — none appear in this plan.

**Placeholder scan:** all steps contain full code; no TBD or "implement later" present.

**Type consistency:**
- `BulletinCidFields = { codec: number; digestBytes: Uint8Array }` — introduced in Task 5 and used consistently in Tasks 6, 8, 9, 11
- `Listing` interface defined in Task 5 (`useContentRegistry.ts`) and used in Tasks 7, 9, 12
- `ChecklistStep` / `StepStatus` defined in Task 11 (`CreateChecklist.tsx`) and used in Task 11 (`CreatePage.tsx`)
- `uploadToBulletin` in Task 6 returns `BulletinCidFields` — matches parameter types in Task 5's `submitCreateListing`
