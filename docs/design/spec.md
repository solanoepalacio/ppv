# Pay-Per-View — Design Spec

> **Status:** Working checkpoint.
> **Last updated:** 2026-04-17.

## 1. Terminology

- **Content creator** — the account that uploads content and lists it for sale.
- **Buyer** — the account that paid for a specific listing.
- **Encrypted content** — the content creator's original content, encrypted client-side and uploaded to Bulletin Chain (accessed via its IPFS-compatible CID).
- **Content-lock-key** — the symmetric key used to encrypt a specific piece of content. One per content item.
- **Buyer encryption key** — an x25519 keypair the buyer generates in their browser. The private half stays in the sandbox; the public half is registered on-chain so the chain-service can wrap content-lock-keys to it.
- **Chain-service** — an off-chain daemon co-located with the parachain collator. Holds a master keypair `(SVC_PUB, SVC_PRIV)`. Observes purchase events and re-wraps content-lock-keys from `SVC_PUB` to the buyer's encryption key.
**Identity model.** Both content creators and buyers are identified solely by their Polkadot account address. No People chain integration, no out-of-band identity binding — the platform is fully pseudonymous.

## 2. Architecture overview

End-to-end data flow:

1. **Creator** encrypts content client-side, uploads ciphertext to Bulletin Chain, receives a CID.
2. **Creator** submits `create_listing` with: CID, plaintext hash, price, title, description, and the content-lock-key wrapped to `SVC_PUB`.
3. **Buyer** submits `purchase(listing_id)` (batched with `register_encryption_key` on the first buy). The pallet transfers funds and records the purchase.
4. **Chain-service** observes the `PurchaseCompleted` event, unwraps the content-lock-key with `SVC_PRIV`, re-wraps it to the buyer's registered x25519 pubkey, and writes the result to `WrappedKeys[(listing_id, buyer)]`.
5. **Buyer's frontend** reads `WrappedKeys[(listing_id, buyer)]`, decrypts the wrapped key in pure JS using the browser-held x25519 private key, fetches ciphertext from Bulletin Chain, decrypts the content, verifies the plaintext hash, renders.

## 3. Phased scope

Each phase is demoable on its own.

### Phase 1 — Core flow (MVP)
- Custom FRAME pallet with content registry, payments, and purchase tracking.
- Payments in the parachain's native token via `pallet-balances`.
- Content stored on Bulletin Chain **unencrypted**. Access control is UX-level only — anyone with the CID can fetch the bytes. This is an acknowledged limitation mitigated on phase 2.
- Plaintext hash recorded on the listing and verified by the frontend post-fetch (forward-compatible with Phase 2).
- Frontend runs inside the Polkadot Triangle host (sandboxed), using PAPI to talk to the parachain and Bulletin Chain.
- Frontend built as a static bundle, deployed to IPFS, registered on DotNS.

### Phase 2 — Content encryption with a browser-held session key registered on-chain
- Creator encrypts content client-side before upload (see [Encryption model](#7-encryption-model-phase-2)).
- Pallet gains `EncryptionKeys` (buyer x25519 pubkeys) and `WrappedKeys` (buyer-specific wrapped content-lock-keys) storage.
- Chain-service daemon automates key re-wrapping on payment events.
- Buyer frontend decrypts in pure JS, using a session private key held in sandbox-local storage.
- Access control becomes cryptographic.

### Phase 3 — Stablecoin payments via Asset Hub
**This phase will be designed after phase 1 and 2 are finished if there's available time**. In the meantime content can only be payed in the parachain native token.
- Accept DOT and USDC (asset id 1337) on Asset Hub.
- Requires registering the parachain on Paseo (collator, parachain slot, HRMP channel to Asset Hub).
- XCM-based payment verification.
- Buyers no longer need to hold DOT.

### Phase 4 — UX improvements
**Nice-to-have; will be designed and built only if the earlier phases land with time to spare.** Not a primary deliverable. Until this phase is built, both items below are acknowledged limitations of the PoC.
- **Content renewal via on-chain hooks.** Bulletin Chain content expires in ~14 days. A pallet hook (`on_initialize` or `on_finalize`) scans listings approaching expiry and triggers renewal (via OCW calling `TransactionStorage.renew` on Bulletin Chain), so creators don't have to re-upload.
- **Session-key recovery.** Smooth recovery flow for buyers who lose their browser-held x25519 private key. Introduces a `regrant_access(listing_ids)` extrinsic (signed by the buyer) that emits events the chain-service observes to re-wrap each listing's content-lock-key under the caller's newly registered encryption key. Until this exists, a key loss means permanent loss of access to past purchases.

### Phase 5 — Service key rotation
**Not expected to be implemented short-term.** `ServiceAccountId` and `ServicePublicKey` are genesis-set and immutable in Phases 1–4; any replacement requires resetting the chain. Phase 5 would add an on-chain path to rotate both, exercised as a learning exercise in Polkadot storage migrations rather than an operational need (the demo chain is not expected to stay active).
- **`ServiceAccountId` rotation.** Straightforward: accept `grant_access` from a new sr25519 signer going forward; past grants are already written.
- **`ServicePublicKey` rotation.** Non-trivial. Existing `Listings[*].locked_content_lock_key` entries are sealed to the old `SVC_PUB`, so the daemon must hold both old and new `SVC_PRIV`s during a transition window — unseal past listings with the old key, seal new listings with the new one. Clients must re-fetch `ServicePublicKey` between caching and use; a version tag on the storage value lets creators detect mid-upload rotation and retry. Lost `SVC_PRIV` for any retired key makes all listings sealed under it permanently un-grantable.
- **Governance path.** Depends on what replaces sudo by the time this phase is reached (council motion, democracy referendum, or a bespoke operator-multisig origin).

## 4. Pallet design

> Exact bounds and encodings (`BoundedVec` limits, field widths, integer types) are finalized during implementation. The shapes below are intent-level, not final wire formats.

### Storage items

```rust
// Phase 1
NextListingId: StorageValue<u64>
Listings:      StorageMap<ListingId, Listing<T>, OptionQuery>
Purchases:     StorageDoubleMap<AccountId, ListingId, BlockNumberFor<T>, OptionQuery>  // value = block number of purchase; used by frontend to sort "My Purchases" by time

// Phase 2
ServicePublicKey:  StorageValue<[u8; 32], ValueQuery>     // SVC_PUB (x25519); set at genesis, immutable
ServiceAccountId:  StorageValue<AccountId, ValueQuery>    // sr25519 account authorized to call grant_access / regrant_access; set at genesis, immutable
EncryptionKeys:    StorageMap<AccountId, [u8; 32], OptionQuery>
WrappedKeys:       StorageDoubleMap<ListingId, AccountId, BoundedVec<u8, ...>, OptionQuery>
```

### `Listing` struct

```rust
struct Listing<T: Config> {
    creator: T::AccountId,
    price: BalanceOf<T>,
    content_cid: BulletinCid,                       // Codec + blake2b-256 digest of stored bytes (ciphertext in Phase 2, plaintext in Phase 1).
    thumbnail_cid: BulletinCid,                     // Codec + blake2b-256 digest of the thumbnail image. Always stored unencrypted (even in Phase 2) — the browse grid must render without keys.
    content_hash: [u8; 32],                         // blake2b-256 of plaintext
    title: BoundedVec<u8, ConstU32<128>>,
    description: BoundedVec<u8, ConstU32<2048>>,
    locked_content_lock_key: BoundedVec<u8, ...>,   // Phase 2: sealed to SVC_PUB. Empty in Phase 1.
    created_at: BlockNumberFor<T>,
}

struct BulletinCid {
    codec:  u8,                                     // 0x55 (raw) for ≤2 MiB single-chunk, 0x70 (dag-pb) for chunked DAG manifests.
    digest: [u8; 32],                               // blake2b-256. Full CID reconstructs as CIDv1 + codec + multihash(0xb220, 32, digest).
}
```

### Extrinsics

**Phase 1**
- `create_listing(content_cid, thumbnail_cid, content_hash, title, description, price) -> ListingId`
- `purchase(listing_id)` — transfers `price` from buyer to creator; records `Purchases[(listing_id, buyer)]`; emits `PurchaseCompleted`.

**Phase 2**
- `register_encryption_key(pubkey: [u8; 32])` — writes `EncryptionKeys[caller]`.
- `create_listing` gains a `locked_content_lock_key` parameter.
- `grant_access(listing_id, buyer, wrapped_key)` — origin must satisfy `T::ServiceOrigin` (see [Service origin](#service-origin) below). Writes `WrappedKeys[(listing_id, buyer)]`. Marked `Pays::No` so the chain-service account does not pay transaction fees.

**Phase 4** (deferred — see §3)
- `regrant_access(listing_ids)` — signed origin (the buyer). Session-key recovery; emits events the chain-service observes to re-wrap each listing's content-lock-key under the caller's newly registered encryption key.

### Events
- `ListingCreated { listing_id, creator, price }`
- `PurchaseCompleted { listing_id, buyer, creator }`
- `EncryptionKeyRegistered { account }` *(Phase 2)*
- `AccessGranted { listing_id, buyer }` *(Phase 2)*

### Service origin

`grant_access` is authorized via a custom origin rather than an inline account-equality check. This separates *who is allowed to call* from *what the call does* — the same pattern `pallet-treasury` and `pallet-collective` use for their specialized origins.

The pallet exposes an associated type on its `Config`:

```rust
type ServiceOrigin: EnsureOrigin<OriginFor<Self>>;
```

The runtime binds it to an `EnsureServiceAccount<Runtime>` struct that implements `EnsureOrigin` by calling `ensure_signed(origin)?` and comparing the signer against `ServiceAccountId::get()`. Any other signer fails with `BadOrigin`.

Inside `grant_access`, authorization is a single line:

```rust
T::ServiceOrigin::ensure_origin(origin)?;
```

Combined with `Pays::No` on the dispatchable, the daemon is authorized to call but does not pay fees. Because only `ServiceOrigin` can make the call, the fee-free path is not a spam vector. For pallet tests, the mock runtime binds `ServiceOrigin` to `EnsureSignedBy<Alice, _>` instead.

### Validation rules

Pallet extrinsics enforce the following preconditions; violations return a dispatch error:

- `create_listing`: `price > 0`. Free content is out of scope for the PoC.
- `purchase`: `buyer != creator`. Creators cannot purchase their own listings.
- `purchase`: `Purchases[(listing_id, buyer)]` must not already exist. A given buyer can purchase any listing at most once.

### Batched first-write UX
The first on-chain write that depends on an `EncryptionKeys[caller]` entry must register one first. This applies symmetrically to:
- **First purchase** — `pallet-utility::batch_all([register_encryption_key, purchase])`.
- **First listing creation** — `pallet-utility::batch_all([register_encryption_key, create_listing])`. Required because the chain-service wraps the content-lock-key for the creator on `ListingCreated` (see [Chain-service grant flow](#chain-service-grant-flow)), which needs the creator's x25519 pubkey to already be on-chain.

Both batches produce a single phone signature and are atomic. Subsequent calls of either extrinsic use the plain extrinsic directly.

Fallback if `batch_all` proves awkward UX using Triangle (e.g., phone UI doesn't decode inner calls readably): replace with a one-time "Set up your account" step that registers the encryption key up-front. One extra signature, one-time.

### Fee model
- Content creators set a fixed flat price per listing. No tiers, no promotional pricing, no per-buyer negotiation.
- No platform fee, no treasury cut. The buyer's payment is transferred in full to the creator as part of `purchase`.
- Transaction fees are paid by each extrinsic's caller — the standard Polkadot default. The creator pays the fee for `create_listing` and the buyer pays the fee for `purchase` (and, in Phase 4, for `regrant_access`). `grant_access` is marked `Pays::No`: the chain-service account is authorized via `ServiceOrigin` but is not charged for the call. The account only requires a one-time existential deposit; no ongoing top-ups. Since only `ServiceOrigin` can call, the fee-free path is not a spam vector.

## 5. Encryption model (Phase 2)

### Keys in play

- **`SVC_PUB` / `SVC_PRIV`** — x25519 keypair used solely for wrapping and unwrapping content-lock-keys.
  - `SVC_PUB` is published on-chain via the `ServicePublicKey` storage item; set once in the genesis config; immutable thereafter. Creators fetch it via PAPI before sealing `locked_content_lock_key`.
  - `SVC_PRIV` is held by the daemon as a single key file on disk (`chmod 600`, daemon-owned directory `chmod 700`). Path passed to the daemon at startup via CLI flag or env var. No passphrase protection in the PoC.
  - Rotation is out of scope.
- **`SERVICE_ACCOUNT_KEY`** — separate sr25519 keypair held by the daemon as a key file (not in the Substrate keystore, since the daemon is an external process, not a node plugin). Signs `grant_access` and the chain-service's response to `regrant_access` events. The corresponding AccountId is stored on-chain in `ServiceAccountId` (genesis-set) and is the only signer accepted by the pallet's `ServiceOrigin`. The account needs a one-time existential deposit to exist, but does not pay transaction fees (`grant_access` is marked `Pays::No`).
- **Buyer encryption keypair** — x25519 generated client-side in the buyer's browser. Private half persisted to sandbox-local storage; public half registered on-chain via `register_encryption_key`.
- **Content-lock-key** — random symmetric key generated client-side, one per content item. Never stored or transmitted in the clear.

### Creator upload flow

Thumbnail extraction and upload apply to both Phase 1 and Phase 2; encryption and sealing steps are Phase 2 only and labeled accordingly.

1. Extract three candidate thumbnail frames from the video client-side via `<canvas>` at jittered random timestamps; creator picks one. The chosen frame is encoded as PNG or JPEG bytes.
2. *(Phase 2 only)* Generate a random content-lock-key.
3. *(Phase 2 only)* Encrypt the content with the content-lock-key.
4. Compute the CID of the content bytes (ciphertext in Phase 2, plaintext in Phase 1) and of the thumbnail bytes, offline via the SDK — no network call. The SDK returns CIDv1 + codec (`raw` 0x55 for single-chunk, `dag-pb` 0x70 for chunked DAG manifest) + 32-byte blake2b-256 digest. Both codec and digest are stored on the listing as `content_cid: BulletinCid` and `thumbnail_cid: BulletinCid`.
5. Ensure the user account has Bulletin Chain authorization by submitting `authorize_account(userAddress, txCount, bytes)`, signed by `//Alice`. On Paseo testnet, `Alice` is in the `TransactionStorage::Authorizer` origin's `TestAccounts` set and is the sanctioned signer for authorize calls — no user signature or fee. The authorization grants the connected user account a per-session quota (default 10 transactions / 100 MiB) for signing `store()` directly. Before every upload the frontend queries the user's remaining authorization on-chain and only calls `authorize_account` when the remaining quota is insufficient for the upload at hand; there is no in-memory cache. (Mainnet Bulletin is not yet deployed; out of scope.) `scripts/verify-bulletin-faucet.ts` exercises the preimage-authorization variant against `wss://paseo-bulletin-rpc.polkadot.io`; account-authorization is exercised by the frontend's upload flow.
6. Submit two signed `store()` calls via `@parity/bulletin-sdk` — one for the thumbnail, one for the content — each signed by the **user** account (not Alice). The prior `authorize_account` grant gates the writes. Phase 1 caps each upload at the SDK's 2 MiB single-tx threshold; Paseo Bulletin's chunked path is unstable under load (per-chunk blake2b-256 + DAG-PB manifest construction), so the chunked code path is deliberately avoided until the SDK issue is resolved. The thumbnail is always stored unencrypted (even in Phase 2) so the browse grid can render without keys.
7. Compute `blake2b-256(plaintext)` for the `content_hash` field.
8. *(Phase 2 only)* Fetch `SVC_PUB` from the `ServicePublicKey` storage item via PAPI; seal the content-lock-key to it → `locked_content_lock_key`.
9. Submit `create_listing(content_cid, thumbnail_cid, content_hash, title, description, price[, locked_content_lock_key])`. The `locked_content_lock_key` parameter is Phase 2 only. On first-ever listing creation, this is batched with `register_encryption_key` via `pallet-utility::batch_all` — see [Batched first-write UX](#batched-first-write-ux).
10. *(Phase 2 only)* The creator's frontend retains the plaintext content-lock-key in memory for the remainder of the current session, so the creator can play back the content they just uploaded without waiting for the chain-service to write `WrappedKeys[(listing_id, creator)]`. The key is **not** persisted to local-storage — on a fresh session the creator reads the wrapped key from chain like any buyer would.

### Purchase flow
1. If the buyer hasn't registered an encryption key yet, generate an x25519 keypair in the browser and persist the private half to sandbox local-storage.
2. Submit `purchase(listing_id)` — batched with `register_encryption_key` on the first purchase.
3. Pallet transfers funds (if user has enough funds), records the purchase, emits `PurchaseCompleted`.

### Chain-service grant flow

The daemon subscribes to two events via subxt (types generated from parachain metadata via `subxt-codegen`): `PurchaseCompleted` and `ListingCreated`. Both dispatch the same wrap-and-grant routine, differing only in which account receives the wrapped key.

**On `PurchaseCompleted(listing_id, buyer, creator)`** — target is the buyer.

**On `ListingCreated(listing_id, creator, price)`** — target is the creator. This unifies creator playback with the regular decryption path: the creator reads their own wrapped key from `WrappedKeys[(listing_id, creator)]` the same way a buyer reads theirs.

Shared steps (applied with the appropriate target):

1. Read `Listings[listing_id].locked_content_lock_key` and `EncryptionKeys[target]`.
2. Unseal the content-lock-key with `SVC_PRIV`.
3. Seal the content-lock-key to the target's x25519 pubkey → `wrapped_key`.
4. Submit `grant_access(listing_id, target, wrapped_key)` signed with `SERVICE_ACCOUNT_KEY`; the extrinsic is authorized by `ServiceOrigin` and marked `Pays::No`.

Because creators batch `register_encryption_key` with their first `create_listing` (see [Batched first-write UX](#batched-first-write-ux)), `EncryptionKeys[creator]` is guaranteed to exist at the moment the daemon handles `ListingCreated`.

### Buyer and creator decryption flow

The same flow applies to any account that has a `WrappedKeys[(listing_id, account)]` entry, whether they obtained it by purchasing the listing or by creating it.

1. Frontend subscribes to `WrappedKeys[(listing_id, currentAccount)]`.
2. Once populated, reads the account's x25519 private key from sandbox local-storage.
3. Unseals `wrapped_key` in pure JS → recovers the content-lock-key. Phone is not involved.
4. Reconstructs the content CID from `Listings[listing_id].content_cid` (CIDv1 + `codec` + multihash(blake2b-256, `digest`)) and fetches ciphertext from any public IPFS gateway. Bulletin Chain reads are served over IPFS, not the parachain RPC.
5. Decrypts the ciphertext using the content-lock-key.
6. Recomputes `blake2b-256(plaintext)` and compares to `Listings[listing_id].content_hash`; surfaces a verified-content indicator.
7. Renders.

**Creator fast-path for the same session.** Immediately after upload the creator's frontend holds the plaintext content-lock-key in memory (step 10 of [Creator upload flow](#creator-upload-flow)) and can play back their content without waiting for the daemon to write `WrappedKeys[(listing_id, creator)]`. On any fresh session the creator falls through to the normal decryption flow above.

## 6. Frontend model

- **Polkadot Triangle sandbox.** The frontend runs inside an isolated shell provided by a Triangle host. No direct WebSocket or fetch — all chain access goes through PAPI providers supplied by the host.
- **Bulletin client.** Writes use `@parity/bulletin-sdk`, which accepts the Triangle-provided PAPI provider (BYOC — SDK doesn't own the connection). Reads resolve via any public IPFS gateway. Promise-based API; no raw Observable handling needed.
- **Signing.** Delegated to the paired mobile host via Statement Store relay. Every on-chain action is phone-confirmed.
- **Decryption.** Performed in pure JS inside the sandbox using a browser-held x25519 private key. The Triangle host API does not expose a decryption primitive.
- **Session-key persistence.** Buyer's x25519 private key is persisted via the host's `createLocalStorage` primitive — host-mediated, per-product key-scoped (namespaced by the host, not by the app). Direct access to browser `localStorage`/`IndexedDB` from inside the sandbox is prohibited; the host primitive is the only supported path.
- **Session-key loss recovery.** Not handled in Phase 2 — key loss means permanent loss of access to past purchases. A smooth recovery flow is deferred to Phase 4 (§3).
- **Account model.** One Polkadot account per user (the Triangle host account), accessed via the host's account APIs. In local dev (Zombienet), the frontend pins a fixed non-Alice dev account (Bob by default) as the user so the two-signer flow is exercised end-to-end; no account switcher is exposed — revisit post-Phase 1c once host-mode deployment has been demoed.
- **Signers.** The frontend holds two distinct signers. A **user signer** (Triangle-provided in host mode, dev-derived in local mode) signs every parachain extrinsic (`create_listing`, `purchase`, `register_encryption_key`, batch wrappers) and the Bulletin `store()` call. An **Alice signer** (derived in-browser from `//Alice` via `sr25519CreateDerive`) is used **only** to sign Bulletin `authorize_account` calls, since Alice is in Paseo Bulletin's `TestAccounts` set for the `Authorizer` origin. Alice never signs parachain extrinsics; the user signer never signs Bulletin authorization calls.

## 7. Deployment model

- **Local development.** Relay + parachain via Zombienet. This is the supported path for Statement Store RPCs in the current SDK release, and Statement Store is required by Triangle. Single machine; no external registration needed.
- **Phase 1–2 frontend.** Built as a static bundle, hosted on **Bulletin Chain** and registered on **DotNS** (`.dot` domain resolving to the Bulletin CID). Deployment runs through the `.github/workflows/deploy-frontend.yml` GitHub Action, which invokes the reusable `paritytech/dotns-sdk/.github/workflows/deploy.yml@main` workflow — it handles bundle upload (`dotns bulletin authorize` + `dotns bulletin upload`) and DotNS content-hash registration (`dotns content set`) as a single operation. On Paseo, Alice signs DotNS registration (free for dev accounts); no repo secret needed for the PoC. Bulletin's ~14-day retention is acknowledged: the action is re-run before each demo to refresh the pin. The older IPFS-via-w3.storage path (`scripts/deploy-frontend.sh`) is kept as a manual fallback but is not the supported Phase 1c path. Full trace in `docs/research/frontend-deploy.md`.
- **Phase 3 infrastructure.** Parachain registers on Paseo (collator, parachain slot, HRMP channel to Asset Hub for XCM). Real ops lift, planned for when Phase 3 is active.
- **Operational setup (chain-service keys).**
  - Operator generates the x25519 SVC keypair (`SVC_PRIV` / `SVC_PUB`) on a secure machine. `SVC_PUB` bytes are embedded in the genesis config under `ServicePublicKey`.
  - Operator generates (or reuses) the sr25519 service account keypair. The corresponding AccountId is embedded in the genesis config under `ServiceAccountId` and receives a one-time existential deposit transfer at setup time.
  - Daemon configured with both key files (`SVC_PRIV` and the sr25519 service key) at locked-down paths (files `chmod 600`, daemon-owned directory `chmod 700`). Paths passed via CLI flags or env vars.
  - Daemon runs as a Rust binary (subxt) alongside the collator; it talks to the parachain via subxt over the node's RPC endpoint. No keys live in the Substrate keystore.
  - No generated keys are ever committed to git.
