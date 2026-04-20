# Two-Signer Account Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the currently-merged Alice-for-everything signer into two distinct signers — an **Alice signer** used exclusively for Bulletin Chain authorization extrinsics, and a **user signer** used for every other on-chain action — so the frontend matches the Triangle host-api-example's single-account model and is drop-in ready for host deployment.

**Architecture:** Dev mode and host mode expose the same API shape: one selected user account (no switcher), plus a separately-held Alice signer that the Bulletin upload path uses for `authorize_account`. Host mode sources the user account from `createAccountsProvider` (Triangle). Dev mode sources it from a fixed non-Alice entry in `devAccounts` (Bob). Alice is derived in-browser the same way in both modes. The current `signed store()` upload path stays (the unsigned preimage path is known-broken on Paseo); what changes is that Alice's role shrinks to pre-authorizing the user account via `authorize_account(userAddress, transactions, bytes)`, and the user signs `store()` themselves through a second `AsyncBulletinClient` instance.

**Tech Stack:** React + Vite + TypeScript + Vitest, PAPI (`polkadot-api`), `@novasamatech/product-sdk`, `@parity/bulletin-sdk`, `@polkadot-labs/hdkd` (sr25519 dev-account derivation), Zustand (`chainStore`).

---

## File Structure

| File | Role | Status |
| --- | --- | --- |
| `web/src/hooks/useParachainProvider.ts` | Owns PAPI client init, user-signer selection (host vs dev), Alice-signer derivation, subscription to user-account changes. Exposes `getParachainApi`, `getUserSigner`, `getUserAddress`, `getAliceSigner`, `subscribeUserAccount`. | Rewrite |
| `web/src/hooks/useAccount.ts` | Derive dev accounts (Alice/Bob/Charlie). Add `DEV_USER_INDEX` constant and `aliceAccount` / `getAliceSigner` helpers. | Extend |
| `web/src/hooks/useBulletinUpload.ts` | Two `AsyncBulletinClient` instances (Alice for `authorize_account`, user for `store`). Idempotent per-session authorization. | Rewrite |
| `web/src/hooks/useContentRegistry.ts` | Switch `getCurrentSigner` callers → `getUserSigner`. | Modify |
| `web/src/store/chainStore.ts` | No schema change; continues to hold `account`/`balance`/`connected`. | Keep |
| `web/src/App.tsx` | Top-bar label: `No account` → `Pair your Polkadot App to get started` when connected but `account === null`. | Minor edit |
| `web/src/pages/AccountsPage.tsx` | Dev-only sudo funding flow already uses Alice directly — keep as-is. Verify balance panel still works with Bob as user. | Verify |
| `web/src/hooks/useParachainProvider.test.ts` | Extend to cover new accessors + subscribe semantics. | Extend |
| `web/src/hooks/useBulletinUpload.test.ts` | Update to assert two-signer operation order (authorize by Alice, store by user). | Rewrite tests |
| `web/src/hooks/useContentRegistry.test.ts` | Update any mocks that refer to `getCurrentSigner`. | Update |
| `docs/design/spec.md` | §5.1 steps 5–6 (swap preimage-unsigned story for account-auth signed story) and §6 (add explicit "Signers" bullet). | Edit |

### Decision log (locked in via brainstorming)

1. **User account in dev mode = Bob (`devAccounts[1]`).** Alice is reserved for Bulletin authorization; picking a different dev account as the user makes the two-signer flow observable locally.
2. **Authorization call = `authorize_account(userAddress, txCount, bytes)` signed by Alice**, not `authorize_preimage`. The preimage-unsigned path is known-broken on Paseo (PAPI bare submit has no timeout; SIGILL on chunked). Signed `store()` is the only reliable path, so authorization must cover the user account, not the content hash.
3. **Authorization is lazy and per-session.** First upload in a browser session triggers `authorize_account`; subsequent uploads reuse the authorization until the page reloads. No on-chain read to check if authorization already exists — re-authorizing is cheap and idempotent for our quotas.
4. **Quota for `authorize_account` = 10 transactions, 100 MiB.** Generous enough to cover many uploads per session; small enough not to drain Alice. Exported as a constant.
5. **No account switcher UI.** Top-bar is display-only in both dev and host modes; user decision on switcher is deferred until after DotNS deployment in Phase 1c.
6. **Host-mode empty-state copy:** `Pair your Polkadot App to get started` (mirrors host-api-example).

---

## Task 1: Update spec §5.1 and §6

**Files:**
- Modify: `docs/design/spec.md:178-180` (steps 5–6 of Creator upload flow)
- Modify: `docs/design/spec.md:222-230` (Frontend model section — add Signers bullet)

No test step — this is a spec update.

- [ ] **Step 1: Replace spec §5.1 step 5**

Replace lines 178–179 (the `authorize_preimage` + "Alice in TestAccounts" paragraph) with:

```markdown
5. Submit `authorize_account(userAddress, txCount, bytes)` to Bulletin Chain once per browser session, signed by `//Alice`. On Paseo testnet, `Alice` is in the `TransactionStorage::Authorizer` origin's `TestAccounts` set and is the sanctioned signer for authorize calls — no user signature or fee. The authorization grants the currently-connected user account a per-session quota (default 10 transactions / 100 MiB) for signing `store()` directly. Authorization is in-memory cached and re-issued on page reload. (Mainnet Bulletin is not yet deployed; out of scope.) `scripts/verify-bulletin-faucet.ts` exercises the preimage-authorization variant; account-authorization is exercised by the frontend's upload flow.
```

- [ ] **Step 2: Replace spec §5.1 step 6**

Replace line 180 with:

```markdown
6. Submit the content store and the thumbnail store to Bulletin Chain, each signed by the user account via `@parity/bulletin-sdk` (`AsyncBulletinClient` constructed with the user signer). Signed `store()` gates on the prior `authorize_account` quota. Paseo Bulletin's chunked upload path is unstable (per-chunk blake2b + DAG-PB manifest panics under load), so Phase 1 caps uploads at the SDK's 2 MiB single-tx threshold; the thumbnail is always stored unencrypted so the browse grid can render without keys.
```

- [ ] **Step 3: Add "Signers" bullet to §6**

Insert a new bullet between lines 230 (current `Account model.` bullet) and 231, and reword the `Account model.` bullet:

```markdown
- **Account model.** One Polkadot account per user (the Triangle host account), accessed via the host's account APIs. Dev mode pins a fixed non-Alice dev account (Bob by default) as the user so the two-signer model is exercised end-to-end against Zombienet.
- **Signers.** Two signers are held by the frontend: a **user signer** (Triangle-provided in host mode, dev-account-derived in dev mode) signs every parachain extrinsic (`create_listing`, `purchase`, `register_encryption_key`, Bulletin `store()`); an **Alice signer** (derived in-browser from `//Alice` via `sr25519CreateDerive`) is used **only** to sign Bulletin Chain `authorize_account` calls. The Alice signer never signs parachain extrinsics. The user signer never signs Bulletin authorization calls.
```

- [ ] **Step 4: Do NOT commit**

Per project convention (`feedback_execution_protocol.md`), the user commits spec changes themselves. Announce that the spec is updated and ready for their review.

---

## Task 2: Extend `useAccount.ts` with explicit Alice helpers

**Files:**
- Modify: `web/src/hooks/useAccount.ts`

- [ ] **Step 1: Add failing test**

Create `web/src/hooks/useAccount.test.ts`:

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

  test('getAliceSigner returns a signer with publicKey matching Alice', () => {
    const signer = getAliceSigner();
    expect(signer).toBeDefined();
    expect(signer).toBe(devAccounts[0].signer);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd web && npx vitest run src/hooks/useAccount.test.ts`
Expected: fails with "`aliceAccount` is not exported" (and similar for `DEV_USER_INDEX`, `getAliceSigner`).

- [ ] **Step 3: Add the exports**

At the bottom of `web/src/hooks/useAccount.ts`, before the final line of the file:

```typescript
/**
 * Dev-mode: which entry in `devAccounts` acts as the "connected user account".
 *
 * NOT Alice. Alice is reserved for Bulletin Chain authorization extrinsics
 * (see `getAliceSigner`), so using a different account as the user exercises
 * the two-signer flow end-to-end against Zombienet.
 */
export const DEV_USER_INDEX = 1;

/** Alice is always devAccounts[0] — the canonical Bulletin authorization signer. */
export const aliceAccount = devAccounts[0];

/**
 * Returns Alice's PAPI signer. Use ONLY for Bulletin Chain `authorize_account`
 * / `authorize_preimage`. Never use to sign parachain extrinsics.
 */
export function getAliceSigner(): PolkadotSigner {
  return aliceAccount.signer;
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `cd web && npx vitest run src/hooks/useAccount.test.ts`
Expected: 3 passing tests.

- [ ] **Step 5: Do NOT commit yet** — will bundle with Task 3.

---

## Task 3: Refactor `useParachainProvider.ts` — dual signers + subscription

**Files:**
- Modify: `web/src/hooks/useParachainProvider.ts`
- Modify: `web/src/hooks/useParachainProvider.test.ts`

- [ ] **Step 1: Update failing tests**

Replace the contents of `web/src/hooks/useParachainProvider.test.ts` with:

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
    const signer = getAliceSigner();
    expect(signer).toBe(aliceAccount.signer);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd web && npx vitest run src/hooks/useParachainProvider.test.ts`
Expected: fails — `getUserSigner` / `getUserAddress` / `getAliceSigner` not exported by this module.

- [ ] **Step 3: Rewrite `useParachainProvider.ts`**

Replace the full contents of `web/src/hooks/useParachainProvider.ts` with:

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

- [ ] **Step 4: Run provider test — expect PASS**

Run: `cd web && npx vitest run src/hooks/useParachainProvider.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Update callers — swap `getCurrentSigner` → `getUserSigner`**

In `web/src/hooks/useContentRegistry.ts:2`, change:
```typescript
import { getParachainApi, getCurrentSigner } from './useParachainProvider';
```
to:
```typescript
import { getParachainApi, getUserSigner } from './useParachainProvider';
```

And replace both occurrences of `getCurrentSigner()` (lines 96 and 123) with `getUserSigner()`.

- [ ] **Step 6: Run the full hooks test suite — expect PASS**

Run: `cd web && npx vitest run src/hooks/`
Expected: `useAccount`, `useParachainProvider`, `useContentRegistry`, `useBulletinUpload` tests all pass. (`useBulletinUpload` still uses the old single-signer path and keeps passing — we haven't touched it yet.)

- [ ] **Step 7: Do NOT commit yet** — Task 4 is the natural bundle point.

---

## Task 4: Refactor `useBulletinUpload.ts` — two clients, `authorize_account` flow

**Files:**
- Modify: `web/src/hooks/useBulletinUpload.ts`
- Modify: `web/src/hooks/useBulletinUpload.test.ts`

- [ ] **Step 1: Rewrite the failing tests**

Replace `web/src/hooks/useBulletinUpload.test.ts` with:

```typescript
import { describe, test, expect, vi, afterEach } from 'vitest';
import { MockBulletinClient } from '@parity/bulletin-sdk';

import { fetchFromIpfs, uploadToBulletin, __resetAuthorizationForTests } from './useBulletinUpload';
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

// ── uploadToBulletin (two-signer flow) ────────────────────────────────────────

describe('uploadToBulletin', () => {
  afterEach(() => __resetAuthorizationForTests());

  test('returns BulletinCidFields with codec and digestBytes from the store result', async () => {
    const aliceMock = new MockBulletinClient();
    const userMock = new MockBulletinClient();
    const bytes = new Uint8Array(64).fill(0xff);

    const cid = await uploadToBulletin(bytes, undefined, { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' });

    expect(typeof cid.codec).toBe('number');
    expect(cid.digestBytes).toBeInstanceOf(Uint8Array);
    expect(cid.digestBytes.length).toBeGreaterThan(0);
  });

  test('first upload issues authorize_account on Alice client, then store on user client', async () => {
    const aliceMock = new MockBulletinClient();
    const userMock = new MockBulletinClient();
    const bytes = new Uint8Array(64).fill(0xaa);

    await uploadToBulletin(bytes, undefined, { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' });

    const aliceOps = aliceMock.getOperations();
    const userOps = userMock.getOperations();

    expect(aliceOps.some((op) => op.type === 'authorize_account' && op.who === '5Bob')).toBe(true);
    expect(userOps.some((op) => op.type === 'store')).toBe(true);
    // User must never sign an authorization extrinsic.
    expect(userOps.every((op) => op.type !== 'authorize_account')).toBe(true);
    expect(userOps.every((op) => op.type !== 'authorize_preimage')).toBe(true);
    // Alice must never sign a store extrinsic.
    expect(aliceOps.every((op) => op.type !== 'store')).toBe(true);
  });

  test('second upload in the same session skips authorize_account (cached)', async () => {
    const aliceMock = new MockBulletinClient();
    const userMock = new MockBulletinClient();
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(bytes, undefined, { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' });
    await uploadToBulletin(bytes, undefined, { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' });

    const authCount = aliceMock.getOperations().filter((op) => op.type === 'authorize_account').length;
    expect(authCount).toBe(1);

    const storeCount = userMock.getOperations().filter((op) => op.type === 'store').length;
    expect(storeCount).toBe(2);
  });

  test('calls onProgress with values between 0 and 100', async () => {
    const aliceMock = new MockBulletinClient();
    const userMock = new MockBulletinClient();
    const progresses: number[] = [];
    const bytes = new Uint8Array(64).fill(0x01);

    await uploadToBulletin(
      bytes,
      (pct) => progresses.push(pct),
      { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' },
    );

    expect(progresses.length).toBeGreaterThan(0);
    for (const p of progresses) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
  });

  test('rejects files larger than 2 MiB before hitting the chain', async () => {
    const aliceMock = new MockBulletinClient();
    const userMock = new MockBulletinClient();
    const bytes = new Uint8Array(2 * 1024 * 1024 + 1);

    await expect(
      uploadToBulletin(bytes, undefined, { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' }),
    ).rejects.toThrow(/2 MiB/i);

    expect(aliceMock.getOperations()).toEqual([]);
    expect(userMock.getOperations()).toEqual([]);
  });

  test('throws when storage fails', async () => {
    const aliceMock = new MockBulletinClient();
    const userMock = new MockBulletinClient({ simulateStorageFailure: true });
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(
      uploadToBulletin(bytes, undefined, { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' }),
    ).rejects.toThrow();
  });

  test('propagates authorization failure without calling store', async () => {
    const aliceMock = new MockBulletinClient({ simulateStorageFailure: true });
    const userMock = new MockBulletinClient();
    const bytes = new Uint8Array(8).fill(0x00);

    await expect(
      uploadToBulletin(bytes, undefined, { aliceClient: aliceMock, userClient: userMock, userAddress: '5Bob' }),
    ).rejects.toThrow();

    expect(userMock.getOperations().some((op) => op.type === 'store')).toBe(false);
  });
});
```

> **Note on MockBulletinClient:** `@parity/bulletin-sdk` ships a `MockBulletinClient` that records every `authorize_account` / `authorize_preimage` / `store` call as an operation. If inspection confirms the mock does not distinguish `authorize_account` from `authorize_preimage` in its `getOperations()` payload, skip the specific `type === 'authorize_account'` assertions and assert on `type === 'authorize'` (or whatever the mock reports) instead. Run the failing tests first to see the actual op shape before finalizing the assertions. This is the only spot where MockBulletinClient's exact shape matters.

- [ ] **Step 2: Run test — expect FAIL**

Run: `cd web && npx vitest run src/hooks/useBulletinUpload.test.ts`
Expected: fails — `__resetAuthorizationForTests` not exported; `uploadToBulletin` option shape has changed.

- [ ] **Step 3: Inspect MockBulletinClient's actual op shape**

Run: `cd web && node -e "const m=require('@parity/bulletin-sdk'); const c=new m.MockBulletinClient(); c.authorizeAccount('5Bob', 10, 100n).send().then(()=>console.log(JSON.stringify(c.getOperations())))"`

Record the exact `type` string the mock emits for `authorize_account`. If it is not the literal `'authorize_account'`, adjust the three relevant assertions in the test file (search `type === 'authorize_account'`). Re-run step 2 to confirm the test fails for the right reason (missing export / option-shape mismatch, not a typo in the op type).

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

// Per-session authorization quota issued by Alice to the user account.
export const AUTH_TX_COUNT = 10;
export const AUTH_BYTES = 100n * 1024n * 1024n;

let _bulletinPapiClient: PolkadotClient | null = null;
let _aliceClient: AsyncBulletinClient | null = null;
let _userClient: AsyncBulletinClient | null = null;
let _authorizedUser: string | null = null;

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

/** Test-only — clear memoized authorization so each test starts fresh. */
export function __resetAuthorizationForTests(): void {
	_authorizedUser = null;
}

export interface UploadOptions {
	aliceClient?: BulletinClientInterface;
	userClient?: BulletinClientInterface;
	userAddress?: string;
}

async function ensureAuthorization(
	aliceClient: BulletinClientInterface,
	userAddress: string,
): Promise<void> {
	if (_authorizedUser === userAddress) return;
	await aliceClient.authorizeAccount(userAddress, AUTH_TX_COUNT, AUTH_BYTES).send();
	_authorizedUser = userAddress;
}

/**
 * Upload bytes to Bulletin Chain.
 *
 * Two-signer flow:
 *   1. Alice signs `authorize_account(userAddress, AUTH_TX_COUNT, AUTH_BYTES)`
 *      once per session (cached by `userAddress`).
 *   2. The user signs `store()` for the content.
 *
 * Both calls use the signed-store path (`signSubmitAndWatch`) — the SDK's 120s
 * timeout surfaces silent-drop failures. The preimage-authorized unsigned path
 * is deliberately avoided (PAPI bare submit has no SDK-level timeout and hangs
 * indefinitely when Paseo Bulletin delays finalization of bare txs).
 */
export async function uploadToBulletin(
	bytes: Uint8Array,
	onProgress?: (pct: number) => void,
	opts?: UploadOptions,
): Promise<BulletinCidFields> {
	if (bytes.length > MAX_UPLOAD_BYTES) {
		throw new Error(
			`File is too large: ${bytes.length} bytes. Phase 1 PoC supports up to 2 MiB per upload.`,
		);
	}

	const aliceClient = opts?.aliceClient ?? getAliceClient();
	const userClient = opts?.userClient ?? getUserClient();
	const userAddress = opts?.userAddress ?? getUserAddress();
	if (!userAddress) throw new Error("No connected user account for Bulletin upload");

	await ensureAuthorization(aliceClient, userAddress);

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

- [ ] **Step 5: Run test — expect PASS**

Run: `cd web && npx vitest run src/hooks/useBulletinUpload.test.ts`
Expected: all tests pass. If the mock's op-type string differs from `'authorize_account'`, update the test assertions (not the source) to match.

- [ ] **Step 6: Run the full test suite — expect PASS**

Run: `cd web && npx vitest run`
Expected: every test passes. Flag any regression explicitly.

- [ ] **Step 7: Do NOT commit** — user validates first per `feedback_execution_protocol.md`.

---

## Task 5: Update `App.tsx` top-bar empty state

**Files:**
- Modify: `web/src/App.tsx:72` (the `No account` fallback)

- [ ] **Step 1: Update the empty-state label**

Replace the `No account` span with a more host-idiomatic message. At `App.tsx:72`, change:

```tsx
<span className="text-xs text-text-muted">No account</span>
```

to:

```tsx
<span className="text-xs text-text-muted">Pair your Polkadot App to get started</span>
```

- [ ] **Step 2: Manual sanity check**

Start the dev server (`cd web && npm run dev`) and confirm:
- In dev mode (zombienet up): top-bar shows `{Bob_truncated} · {balance}`.
- In dev mode without zombienet running: top-bar shows `Pair your Polkadot App to get started`.

If zombienet is not available right now, note this in your completion report and ask the user to verify manually.

- [ ] **Step 3: Do NOT commit** — user validates first.

---

## Task 6: End-to-end verification against Zombienet + Paseo Bulletin

**Files:**
- None — verification only.

- [ ] **Step 1: Start Zombienet**

Per existing project convention. Parachain must be reachable at `ws://127.0.0.1:9944`.

- [ ] **Step 2: Start the frontend**

```bash
cd web && npm run dev
```

- [ ] **Step 3: Confirm dev user is Bob, not Alice**

Open the app. Top-bar should show Bob's truncated address and Bob's balance — **not** Alice's. If it still shows Alice, `DEV_USER_INDEX` or the provider hasn't been wired correctly.

- [ ] **Step 4: Fund Bob if needed**

Navigate to `AccountsPage` (`/accounts` or wherever it is linked) and fund Bob via the sudo flow. (The sudo call is still signed by Alice explicitly — that's intentional, sudo funding is not a two-signer flow.)

- [ ] **Step 5: Create a listing**

Navigate to `Create`. Upload a small file (≤2 MiB) with a thumbnail. Watch network traffic (or the browser console / Paseo Bulletin explorer) to confirm:
- Alice's address signs exactly **one** `authorize_account(Bob_address, 10, 100 MiB)` — or two, one per client upload (thumbnail + content) — within the session.
- Bob's address signs **every** `store()` call.
- Bob's address signs the `create_listing` extrinsic on the parachain.

- [ ] **Step 6: Purchase a listing (from a different account if needed)**

With Bob still connected, open a different browser profile, set `DEV_USER_INDEX = 2` locally (Charlie), and test purchase. Charlie's address should sign `purchase` on the parachain. Revert the `DEV_USER_INDEX` change before finishing.

- [ ] **Step 7: Report results**

Write a short summary to the user:
- What was tested.
- Which transactions were signed by which account (actual evidence from the explorer, not inferred).
- Anything that didn't work as expected.
- Explicitly ask the user to commit (or to tell you to fix something first).

---

## Self-review (writer's checklist)

- **Spec coverage:** Every requirement of the user's stated goal ("Alice signs Bulletin auth; user signs everything else; dev matches host as closely as possible; no switcher") maps to a task. Task 1 covers spec; Tasks 2–3 cover signers; Task 4 covers Bulletin flow; Task 5 covers top-bar parity with host-api-example; Task 6 covers E2E verification.
- **Placeholder scan:** No `TBD`, `implement later`, or vague "handle edge cases". Every code block is complete. Every command has an expected outcome.
- **Type consistency:** `getUserSigner` / `getUserAddress` / `getAliceSigner` / `subscribeUserAccount` / `DEV_USER_INDEX` / `aliceAccount` / `__resetAuthorizationForTests` / `UploadOptions.{aliceClient,userClient,userAddress}` all used consistently across Tasks 2–4. `MAX_UPLOAD_BYTES` lowered from 20 MiB to 2 MiB to match the comment (and the project memory about the 2 MiB cap being temporary but real).
- **Known unknown:** The exact `type` string `MockBulletinClient` uses for `authorize_account` — Task 4 Step 3 explicitly inspects it before finalizing assertions.
