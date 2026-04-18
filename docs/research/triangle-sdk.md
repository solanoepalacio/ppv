# Polkadot Triangle (Host API) SDK — research notes for ppview

> Sources: `github.com/paritytech/triangle-js-sdks`, `github.com/paritytech/host-api-example`.
> Research date: 2026-04-17.

## Critical finding: host API does NOT expose asymmetric decryption

**The host API does not expose any asymmetric decryption, key agreement, KDF, or private-key-derivation primitive.** Verified by enumerating the entire `hostApiProtocol` constant in `triangle-js-sdks/packages/host-api/src/protocol/impl.ts` (the authoritative wire-protocol definition) and grepping the whole SDK.

The only crypto the host performs on the user's account is:
- **Signing** — `host_sign_payload`, `host_sign_raw`
- **Ring VRF proof creation** — `host_account_create_proof`

There is **no** `decrypt`, `box_open`, `ecies`, `key_agreement`, KDF primitive. There is no way to extract the user's private key.

The `decryptionKey` field on `Statement` is just a 32-byte symmetric key the *publisher* embeds in cleartext; it is not a primitive the host computes.

Two SDK packages ship symmetric/asymmetric crypto:
- `@novasamatech/handoff-service` — AES-GCM
- `@novasamatech/statement-store` — sr25519-ECDH + AES-GCM

**Both require app-supplied keys — neither bridges to the phone-held account key.**

### Implication for ppview Phase 2

Since the host won't decrypt for us, we must choose one of:

1. **Embed the symmetric key in a per-buyer Statement Store statement** — creator computes a sr25519-ECDH shared secret between the buyer's account pubkey and creator's ephemeral key, encrypts the content key with it, publishes. Buyer asks the host to sign a read request; decrypts the statement's payload using an ECDH derivation on their side. This is literally what `@novasamatech/statement-store` is designed for. **This is the path of least resistance and uses existing SDK crypto.**
2. **Use handoff-service with an out-of-band ticket** — less relevant to our flow.
3. **Maintain a sandbox-generated keypair separate from the host account** — browser generates a fresh x25519 keypair, registers the pubkey on the pallet via a host-signed extrinsic, holds the session private key in memory / persisted storage. Decoupled from the account key, survives host-API limitations, but introduces key-persistence UX.

**Leading recommendation**: Option 1 via `@novasamatech/statement-store`, since it's built-in and matches the "browser↔phone messaging via Statement Store" model already in the spec.

---

## Sandbox model

Three sandbox modes, all carrying the same SCALE protocol:
- **iframe** — via `postMessage`
- **webview** — via `MessagePort` injected at `window.__HOST_API_PORT__`
- **QuickJS WASM** — in-browser JS VM

No direct WebSocket, no `fetch`, no `window.injectedWeb3`. **Anything off-chain must go through host calls or be stored on a chain (e.g., Bulletin).**

`createPapiProvider` throws `"PapiProvider can only be used in a product environment"` outside iframe/webview. Need an `isInHost()` guard if you want `pnpm dev` to work on plain Chrome.

---

## Top 3 lift-ready boilerplate pieces from `host-api-example`

1. **`apps/web/src/provider.ts` — `setupProvider()`**
   - TransactionSubmit permission → `createPapiProvider(genesis)` → `createClient` → account fetch → `PolkadotSigner`.
   - Drop-in.
   - Uses `getNonProductAccounts()` as a workaround for issue triangle-js-sdks#113 (`getProductAccount` produces a pubkey PAPI rejects).

2. **`watchTx()` in `main.ts` (~lines 325-386)**
   - Promise-wrapper around `signSubmitAndWatch`'s Observable with cancel button, cleanup, and `txBestBlocksState.found → resolve` + `finalized` background logging.
   - Tedious to write correctly; copy verbatim.

3. **`contract.ts` dry-run-then-send pattern**
   - `contract.query(fn, { origin, data, value })` → throw extracted revert reason on `!success` → `dryRun.value.send().signSubmitAndWatch(signer)`.
   - Only relevant if we touch Revive contracts (we don't, but the dry-run-then-send idiom generalizes to any extrinsic we want to pre-validate).

**Bonus utilities:** `formatTokenAmount` / `parseTokenAmount` (planck vs wei), the two-phase `getValue + watchValue + 6s poll` onboarding pattern, `@parity/host-api-test-sdk` Playwright fixtures in `e2e/`.

---

## Standout limitations to design around

- **`signSubmitAndWatch` is an Observable, never `await` it.** Events: `signed | broadcasted | txBestBlocksState | finalized`. No `invalid` event. Always unsubscribe on both paths. Never destroy the PAPI client in `finally` while the observable is alive.
- **No standalone-mode fallback in the example.** Gate with `isInHost()` if dev-without-host is needed.
- **Statement Store statements are small** (a few KB). Use them for signaling/keys, store actual content elsewhere (Bulletin).
- **Every signing step waits on phone confirmation.** Batch where possible; never chain two signs in one click.
- **Account-format bug (#113)** — use `getNonProductAccounts()` workaround until fixed upstream.
- **Revive gotchas** (not directly relevant to ppview but worth knowing): `MultiAddress.Id(addr)` for tx `dest`, lowercase H160 hex (`Binary.fromHex(addr.toLowerCase())`), snake_case in unsafe API params (`weight_limit`, `ref_time`).

---

## Packages present in `triangle-js-sdks`

- `@novasamatech/product-sdk` — the main host-API binding; account/permission/PAPI provider glue
- `@novasamatech/handoff-service` — AES-GCM helpers for out-of-band ticket exchange
- `@novasamatech/statement-store` — sr25519-ECDH + AES-GCM; ephemeral pub/sub via Statement Store
- `@parity/host-api-test-sdk` — Playwright fixtures for E2E testing dapps under the sandbox
- (full package list to be completed if we need it — see `triangle-js-sdks/packages/`)

## Host-API-example summary

- App directory: `apps/web/`
- Entrypoints: `provider.ts` (wiring), `main.ts` (transaction flow demonstration)
- Shows: account discovery → tx construction → `signSubmitAndWatch` → block inclusion/finalization UX
- Structure is minimal; `main.ts` is a long imperative demo. Good for copy-paste, not as an architectural template.

---

## Next-step recommendations

1. **Phase 1**: lift `provider.ts` and `watchTx()` into ppview's frontend. Gate with `isInHost()`. Use `getNonProductAccounts()` for accounts until #113 lands.
2. **Phase 2**: design the content-key delivery around `@novasamatech/statement-store` (sr25519-ECDH + AES-GCM). Don't try to get the host to decrypt — it won't.
3. **Treat the Triangle sandbox as a firewall**: every network call goes through PAPI/host; no fetch, no raw sockets. Bulletin Chain is reached via its own PAPI client, not HTTP.

## Open questions (may need deeper digging later)

- Full `hostApiProtocol` enumeration — saving the complete host method list to a dedicated reference would help when designing permission flows.
- Exact permission model for multi-chain PAPI providers (can one app connect to both the ppview solochain AND Bulletin AND Statement Store in one sandbox, or are there gating rules?).
- Persistence rules inside the sandbox — localStorage available? IndexedDB? This determines where session keys can live.
