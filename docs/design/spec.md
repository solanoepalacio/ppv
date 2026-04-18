# Pay-Per-View — Design Spec

> **Status:** Working checkpoint.
> **Last updated:** 2026-04-17.

## 1. Terminology

- **Content creator** — the account that uploads content and lists it for sale.
- **Buyer** — the account that paid for a specific listing.
- **Encrypted content** — the content creator's original content, encrypted client-side and uploaded to Bulletin Chain (accessed via its IPFS-compatible CID).
- **Content-lock-key** — the symmetric key used to encrypt a specific piece of content. One per content item.
- **Buyer encryption key** — an x25519 keypair the buyer generates in their browser. The private half stays in the sandbox; the public half is registered on-chain so the chain-service can wrap content-lock-keys to it.
- **Chain-service** — an off-chain component co-located with the parachain collator. Holds a master keypair `(SVC_PUB, SVC_PRIV)`. Observes purchase events and re-wraps content-lock-keys from `SVC_PUB` to the buyer's encryption key. Implemented as an off-chain worker; external-daemon fallback.
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
- Chain-service (off-chain worker preferred; external daemon fallback) automates key re-wrapping on payment events.
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

## 4. Pallet design

> Exact bounds and encodings (`BoundedVec` limits, field widths, integer types) are finalized during implementation. The shapes below are intent-level, not final wire formats.

### Storage items

```rust
// Phase 1
NextListingId: StorageValue<u64>
Listings:      StorageMap<ListingId, Listing<T>, OptionQuery>
Purchases:     StorageMap<(ListingId, AccountId), BlockNumber, OptionQuery>

// Phase 2
ServicePublicKey:  StorageValue<[u8; 32], ValueQuery>     // SVC_PUB (x25519); set at genesis, immutable
ServiceAccountId:  StorageValue<AccountId, ValueQuery>    // sr25519 account authorized to call grant_access / regrant_access; set at genesis, immutable
EncryptionKeys:    StorageMap<AccountId, [u8; 32], OptionQuery>
WrappedKeys:       StorageMap<(ListingId, AccountId), BoundedVec<u8, ...>, OptionQuery>
```

### `Listing` struct

```rust
struct Listing<T: Config> {
    creator: T::AccountId,
    price: BalanceOf<T>,
    content_cid: [u8; 32],                          // Bulletin CID of ciphertext (Phase 2) or plaintext (Phase 1)
    content_hash: [u8; 32],                         // blake2b-256 of plaintext
    title: BoundedVec<u8, ConstU32<128>>,
    description: BoundedVec<u8, ConstU32<2048>>,
    locked_content_lock_key: BoundedVec<u8, ...>,   // Phase 2: sealed to SVC_PUB. Empty in Phase 1.
    created_at: BlockNumberFor<T>,
}
```

### Extrinsics

**Phase 1**
- `create_listing(content_cid, content_hash, title, description, price) -> ListingId`
- `purchase(listing_id)` — transfers `price` from buyer to creator; records `Purchases[(listing_id, buyer)]`; emits `PurchaseCompleted`.

**Phase 2**
- `register_encryption_key(pubkey: [u8; 32])` — writes `EncryptionKeys[caller]`.
- `create_listing` gains a `locked_content_lock_key` parameter.
- `grant_access(listing_id, buyer, wrapped_key)` — origin must equal `ServiceAccountId`. Writes `WrappedKeys[(listing_id, buyer)]`.

**Phase 4** (deferred — see §3)
- `regrant_access(listing_ids)` — signed origin (the buyer). Session-key recovery; emits events the chain-service observes to re-wrap each listing's content-lock-key under the caller's newly registered encryption key.

### Events
- `ListingCreated { listing_id, creator, price }`
- `PurchaseCompleted { listing_id, buyer, creator }`
- `EncryptionKeyRegistered { account }` *(Phase 2)*
- `AccessGranted { listing_id, buyer }` *(Phase 2)*

### Validation rules

Pallet extrinsics enforce the following preconditions; violations return a dispatch error:

- `create_listing`: `price > 0`. Free content is out of scope for the PoC.
- `purchase`: `buyer != creator`. Creators cannot purchase their own listings.
- `purchase`: `Purchases[(listing_id, buyer)]` must not already exist. A given buyer can purchase any listing at most once.

### Batched first-purchase UX
First purchase uses `pallet-utility::batch_all([register_encryption_key, purchase])` — single phone signature, atomic. Subsequent purchases use `purchase` directly.

Fallback if `batch_all` proves awkward UX using Triangle (e.g., phone UI doesn't decode inner calls readably): replace with a one-time "Set up your account" step that registers the encryption key up-front. One extra signature, one-time.

### Fee model
- Content creators set a fixed flat price per listing. No tiers, no promotional pricing, no per-buyer negotiation.
- No platform fee, no treasury cut. The buyer's payment is transferred in full to the creator as part of `purchase`.
- Transaction fees are paid by each extrinsic's caller — the standard Polkadot default. The creator pays the fee for `create_listing`, the buyer pays the fee for `purchase`, and the chain-service account pays the fee for `grant_access` and `regrant_access`. No fee sponsorship or fee-wrapping mechanism.

## 5. Encryption model (Phase 2)

### Keys in play

- **`SVC_PUB` / `SVC_PRIV`** — x25519 keypair used solely for wrapping and unwrapping content-lock-keys.
  - `SVC_PUB` is published on-chain via the `ServicePublicKey` storage item; set once in the genesis config; immutable thereafter. Creators fetch it via PAPI before sealing `locked_content_lock_key`.
  - `SVC_PRIV` is stored outside the Substrate keystore (the keystore's APIs are signing-oriented, not suitable for x25519 decryption) as a single key file on the collator filesystem. `chmod 600`, owner = node user. Path passed to the chain-service component at startup via CLI flag or env var. No passphrase protection in the PoC.
  - Rotation is out of scope.
- **`SERVICE_ACCOUNT_KEY`** — separate sr25519 keypair held in the Substrate keystore (standard Polkadot pattern). Signs `grant_access` and the chain-service's response to `regrant_access` events. The corresponding AccountId is stored on-chain in `ServiceAccountId` (genesis-set). The account must be funded to pay its own tx fees.
- **Buyer encryption keypair** — x25519 generated client-side in the buyer's browser. Private half persisted to sandbox-local storage; public half registered on-chain via `register_encryption_key`.
- **Content-lock-key** — random symmetric key generated client-side, one per content item. Never stored or transmitted in the clear.

### Creator upload flow
1. Generate a random content-lock-key.
2. Encrypt the content with the content-lock-key; upload ciphertext to Bulletin Chain; obtain CID.
3. Compute `blake2b-256(plaintext)` for the hash field.
4. Fetch `SVC_PUB` from the `ServicePublicKey` storage item via PAPI; seal the content-lock-key to it → `locked_content_lock_key`.
5. Submit `create_listing(content_cid, content_hash, title, description, price, locked_content_lock_key)`.

### Purchase flow
1. If the buyer hasn't registered an encryption key yet, generate an x25519 keypair in the browser and persist the private half to sandbox local-storage.
2. Submit `purchase(listing_id)` — batched with `register_encryption_key` on the first purchase.
3. Pallet transfers funds (if user has enough funds), records the purchase, emits `PurchaseCompleted`.

### Chain-service grant flow
1. Off-chain worker (or daemon fallback) observes `PurchaseCompleted(listing_id, buyer)`.
2. Reads `Listings[listing_id].locked_content_lock_key` and `EncryptionKeys[buyer]`.
3. Unseals the content-lock-key with `SVC_PRIV`.
4. Seals the content-lock-key to the buyer's x25519 pubkey → `wrapped_key`.
5. Submits `grant_access(listing_id, buyer, wrapped_key)` from the chain-service account.

### Buyer decryption flow
1. Frontend subscribes to `WrappedKeys[(listing_id, buyer)]`.
2. Once populated, reads the buyer's x25519 private key from sandbox local-storage.
3. Unseals `wrapped_key` in pure JS → recovers the content-lock-key. Phone is not involved.
4. Fetches ciphertext from Bulletin Chain via the content CID.
5. Decrypts the ciphertext using the content-lock-key.
6. Recomputes `blake2b-256(plaintext)` and compares to `Listings[listing_id].content_hash`; surfaces a verified-content indicator.
7. Renders.

## 6. Frontend model

- **Polkadot Triangle sandbox.** The frontend runs inside an isolated shell provided by a Triangle host. No direct WebSocket or fetch — all chain access goes through PAPI providers supplied by the host.
- **Signing.** Delegated to the paired mobile host via Statement Store relay. Every on-chain action is phone-confirmed.
- **Decryption.** Performed in pure JS inside the sandbox using a browser-held x25519 private key. The Triangle host API does not expose a decryption primitive.
- **Session-key persistence.** Buyer's x25519 private key is persisted to sandbox-local storage (localStorage or IndexedDB — to verify empirically which the sandbox permits during early Phase 2 work).
- **Session-key loss recovery.** Not handled in Phase 2 — key loss means permanent loss of access to past purchases. A smooth recovery flow is deferred to Phase 4 (§3).
- **Account model.** One Polkadot account per user (the Triangle host account), accessed via the host's account APIs.

## 7. Deployment model

- **Local development.** Relay + parachain via Zombienet. This is the supported path for Statement Store RPCs in the current SDK release, and Statement Store is required by Triangle. Single machine; no external registration needed.
- **Phase 1–2 frontend.** Built as a static bundle, pinned on **IPFS** (via `w3.storage` or equivalent), and registered on **DotNS** (`.dot` domain resolving to the IPFS CID). Bulletin Chain is deliberately not used for bundle hosting — its ~14-day retention is incompatible with the PoC demo window. The stack template's `scripts/deploy-frontend.sh` provides a working reference; DotNS registration + content-hash updates use the `dotns` CLI from `paritytech/dotns-sdk`. Full trace in `docs/research/frontend-deploy.md`.
- **Phase 3 infrastructure.** Parachain registers on Paseo (collator, parachain slot, HRMP channel to Asset Hub for XCM). Real ops lift, planned for when Phase 3 is active.
- **Operational setup (chain-service keys).**
  - Operator generates the x25519 SVC keypair (`SVC_PRIV` / `SVC_PUB`) on a secure machine. `SVC_PUB` bytes are embedded in the genesis config under `ServicePublicKey`; `SVC_PRIV` is written to the collator's filesystem at a locked-down path (file `chmod 600`, directory `chmod 700`, owner = node user).
  - Operator generates (or reuses) the sr25519 service account keypair. The private key is inserted into the Substrate keystore via `author_insertKey` or by placing the key file in the keystore directory. The corresponding AccountId is embedded in the genesis config under `ServiceAccountId`.
  - Collator started with the standard keystore path plus a CLI flag (or env var) pointing to the x25519 private key file.
  - No generated keys are ever committed to git.
