# Frontend — Views & Flows

> **Status:** Working checkpoint.
> **Last updated:** 2026-04-19.
> **Scope:** Phase 1 (MVP) and Phase 2 (encryption). Phase-2-only behavior is tagged `[P2]`; everything else applies to both phases. Phase 3 (stablecoins) and Phase 4 (UX polish) are out of scope for this document.

This doc describes what the frontend shows and how users move through it. It is the input for wireframes — not a wireframe itself. Visual treatment (typography, spacing, colors) is intentionally out of scope; structure and state are what matter here.

The frontend runs inside a Polkadot Triangle sandbox. All chain access uses PAPI providers supplied by the host. Bulletin writes use `@parity/bulletin-sdk`; Bulletin reads resolve via any public IPFS gateway. Signing is delegated to the paired mobile host — every state-changing action is phone-confirmed. See `spec.md` §6 for the full frontend model.

## 1. Roles and scope

- A single Polkadot account per user, provided by the Triangle host.
- The same account can both create listings and buy listings; the UI makes no distinction between "creator" and "buyer" roles. Any user can do either action at any time.
- There is no sign-up, no login, no profile. Identity is the Polkadot address.

## 2. Content type

- The app is scoped to **video content only**. `file-type`-style content sniffing and other media types are deliberately excluded.
- Any video container is accepted at upload time. Playback uses the browser's native `<video>` element, which reliably handles MP4 (H.264/AAC) and WebM (VP8/VP9/AV1). Less-portable containers (`.mov`, `.avi`, `.mkv`, etc.) may not play inline; the UI falls back to a download button in that case.
- For the demo, the operator controls the uploaded file and will use MP4. Documented as a known limitation.

## 3. Global chrome

A single top bar, visible on every route. No sidebar, no footer, no breadcrumbs.

- **Left** — app name (text-only).
- **Center** — three nav links: `Browse` · `My Purchases` · `Create`. The active route is visually distinguished.
- **Right** — account pill: truncated address (e.g., `5Grw…utQY`) and current balance (e.g., `12.34 DOT`). Clicking the pill opens a popover with the full address, a copy-address button, and a small "powered by Polkadot Triangle" attribution. No connect/disconnect — the Triangle host owns the account.

No global banners or toasts by default. Error feedback lives inline in each view (see §8).

## 4. Routes

| Route | Purpose |
|---|---|
| `/` | Browse — all listings |
| `/listing/:id` | Listing detail — view, purchase, play |
| `/create` | Create a new listing |
| `/purchases` | Buyer's purchased content |
| (unmatched) | 404: "Listing not found" or "Page not found", with a link back to `/` |

There is no dedicated "My Listings" view. A creator finds their own listings through Browse like any other user.

## 5. Views

### 5.1 Browse (`/`)

The app's default route. Only job: let a user pick a listing.

**Header**
- Page title: "Browse".
- Right-aligned count: "N listings".

**Grid**
- Responsive thumbnail grid (roughly 3–4 cards per row on desktop, 1 per row on mobile).
- Sorted by `Listing.created_at` descending (newest first).
- No filters, no sort controls, no search.

**Card**
- Thumbnail image (16:9), fetched from an IPFS gateway using the listing's thumbnail CID.
- Title, truncated to two lines.
- Creator address, truncated (`5Grw…utQY`).
- Price, right-aligned (e.g., `2.5 DOT`).
- On hover: subtle lift; cursor pointer. Clicking anywhere on the card navigates to `/listing/:id`.

**States**
- **Loading** — skeleton cards with the same shape as real cards while listings are being fetched from `Listings` storage via PAPI.
- **Empty** — centered message: "No listings yet." Secondary link: "Create the first listing" → `/create`.

**Data**
- One PAPI storage-map read over `Listings`. Iterates all entries; fine at demo scale. Documented known limitation: production would need an indexer.
- Thumbnails are unencrypted on Bulletin and fetched directly from a public IPFS gateway — no decryption is needed to render the grid.

### 5.2 Listing detail (`/listing/:id`)

Shared layout across every state. Only the media area (left) and the action area (right) change.

**Layout**
- A "← Browse" link above the content.
- **Left column** (≈60% on desktop, full-width on mobile): the media area.
- **Right column** (≈40% on desktop, below the media on mobile):
  - Title (large).
  - Creator address with a copy button.
  - Price.
  - Action area (varies by state; see below).
  - Description (multi-line, below the action area).
  - "Listed on YYYY-MM-DD" fine print at the bottom.

**State 1 — Unpurchased (any buyer, not the creator)**
- Media: thumbnail image with a subtle lock overlay and a "Preview" label.
- Action: `Buy for X DOT` primary button. Beneath it: fine print "Transaction fee paid by you (≈ 0.01 DOT)"; current balance. The button is disabled if the balance is insufficient, with an inline explanation.

**State 2 — Purchased (Phase 1)**
- Media: inline `<video controls>` sourced from a Blob URL built from plaintext bytes fetched from Bulletin via a public IPFS gateway.
- Action: `✓ Purchased` static badge. A small Download icon-button next to it offers the raw file.
- Integrity: after the bytes load, the frontend computes `blake2b-256(plaintext)` and compares against `Listing.content_hash`. On match, a small `✓ Content verified` indicator appears near the player. On mismatch, the player is replaced with a red `⚠ Content failed integrity check` panel (no playback).

**State 3 — `[P2]` Paid, waiting for wrapped key**
- Media: thumbnail with a soft overlay, a centered spinner, and "Preparing your content…".
- Action: `✓ Purchased` badge; no download yet.
- Behavior: the page subscribes to `WrappedKeys[(listing_id, buyer)]`. When the entry appears, the view transitions to state 4 automatically.

**State 4 — `[P2]` Wrapped key granted**
- Visually identical to state 2, plus (if the viewer is the listing's creator) a `Your listing` badge in the action area. The difference is under the hood:
  1. Read `WrappedKeys[(listing_id, currentAccount)]`.
  2. Read the account's x25519 private key from sandbox local-storage.
  3. Unseal the wrapped key in pure JS → recover the content-lock-key.
  4. Fetch ciphertext from a public IPFS gateway using `Listing.content_cid` (CIDv1 + codec + blake2b-256 multihash).
  5. Decrypt the ciphertext in the browser.
  6. Verify `blake2b-256(plaintext) == Listing.content_hash`. Same indicator behavior as state 2.
  7. Build the Blob URL and render.
- This state applies symmetrically to buyers (after purchase) and creators (after the content-unlock-service observes `ListingCreated` and writes the creator's wrapped key). See spec §5.

**State 5 — Creator viewing own listing, same session as upload `[P2]`**
- Used only when the creator opens their freshly created listing before the content-unlock-service has written `WrappedKeys[(listing_id, creator)]`, and the frontend still holds the plaintext content-lock-key in memory from the upload flow.
- Media: inline `<video>` sourced from in-memory decryption using the retained content-lock-key. No round-trip to chain for a wrapped key.
- Action: `Your listing` badge. No Buy button, no stats.
- On any fresh session (page reload, new device), the creator falls through to state 3 → state 4 like a buyer. No divergent code path.
- In Phase 1, "state 5" is simply: creator sees the inline plaintext player from state 2 plus the `Your listing` badge. No encryption, no waiting.

**404 sub-state**
- If `Listings[id]` does not exist, the page renders a full-page "Listing not found" with a link back to `/`.

### 5.3 Create (`/create`)

Progressive-reveal form on a single page. Each section appears only once the previous section's input is valid.

**Section A — Video picker** (always visible)
- Drag-and-drop zone plus a "Choose file" button. No extension filter — bytes are accepted regardless of container.
- After a file is picked: filename, file size, duration (read from an offscreen `<video>`), and an inline preview player for quick confirmation.
- Error messaging is inline under the picker (e.g., "Can't read this file; try another.").

**Section B — Thumbnail picker** (reveals once the video is readable)
- Heading: "Pick a thumbnail."
- Three candidate frames, extracted client-side via `<canvas>` at three random timestamps (e.g., jittered around 20%, 50%, 80% of duration). Each candidate is a selectable tile; the selected one has a highlighted border.
- No shuffle/regenerate control. The operator picks a demo video where at least one of three random frames is acceptable.

**Section C — Metadata** (reveals once a thumbnail is selected)
- Title — required, 1–128 characters, with a character counter.
- Description — required, 1–2048 characters, multi-line, with a character counter.
- Price in DOT — required, `> 0`. Numeric input with decimal handling; a helper line shows the Planck integer that will actually be submitted.

**Section D — Submit** (reveals once metadata is valid)
- A single primary button: `Create listing`.
- Clicking it runs an inline status checklist that stays visible on the page so the user can track progress across long async steps:
  - `[P2]` `⏳ Generating content-lock-key…`
  - `[P2]` `⏳ Encrypting content…`
  - `⏳ Computing content CID…`
  - `⏳ Authorizing preimages on Bulletin…` (one for the thumbnail, one for the content)
  - `⏳ Uploading thumbnail to Bulletin…` with a progress %
  - `⏳ Uploading content to Bulletin…` with a progress %
  - `[P2]` `⏳ Sealing content-lock-key to SVC_PUB…`
  - `⏳ Waiting for signature…` (Triangle phone prompt for `create_listing`, or for the batched `batch_all([register_encryption_key, create_listing])` on first-ever listing creation)
  - `⏳ Submitting create_listing…`
  - `✓ Listed`
- On success: navigate to `/listing/:new_id` (which renders state 5 in the same session, then transitions to state 4 once the content-unlock-service writes the creator's wrapped key).
- On failure at any step: that step flips to a red error state with the underlying message. Earlier completed steps remain green. A `Retry` button retries from the failed step. Retries are naturally idempotent — Bulletin CIDs are deterministic, so re-submitting the same bytes is a no-op once the content is already stored.

**First-ever listing creation `[P2]`**
- If the creator does not yet have an `EncryptionKeys[creator]` entry on-chain, the frontend generates an x25519 keypair, persists the private half to sandbox local-storage, and submits `pallet-utility::batch_all([register_encryption_key(pub), create_listing(...)])` instead of the plain `create_listing`. One phone signature, atomic. Required so the content-unlock-service can wrap the content-lock-key for the creator when it observes `ListingCreated`.

**In-memory content-lock-key `[P2]`**
- From the moment step B generates the content-lock-key, the frontend keeps the plaintext key in React/zustand state (or equivalent) until the tab is closed or the user navigates away. This key powers state 5 playback for the immediate same-session case. It is **not** persisted to local-storage — fresh sessions get the wrapped key from chain like any buyer.

### 5.4 My Purchases (`/purchases`)

The buyer's library.

**Header**
- Page title: "My Purchases".
- Right-aligned count: "N purchased".

**Grid**
- Same card shape as Browse: thumbnail, title, creator address, price. Visually consistent with `/`.
- Sorted by purchase time descending.
- Clicking a card opens `/listing/:id` (state 2 in Phase 1; state 3 or 4 in Phase 2).

**States**
- **Loading** — skeleton cards while purchase entries are being fetched.
- **Empty** — "You haven't bought anything yet." Secondary link: "Browse listings" → `/`.

**Data**
- A single PAPI storage-map prefix scan: `api.query.ContentRegistry.Purchases.getEntries(currentAccount)`. Cheap because `Purchases` is keyed `DoubleMap<AccountId, ListingId, ()>` (first key is the buyer — see §9 spec update).
- For each returned `listing_id`, fetch the corresponding `Listings[listing_id]` entry to populate the card. Fetched in parallel.

## 6. Flows

This section describes the cross-view user journeys. Individual view behavior is in §5.

### 6.1 Upload a listing (creator)

1. Creator navigates to `/create`.
2. Picks a video file.
3. Picks one of three auto-extracted thumbnail frames.
4. Fills title, description, price.
5. Clicks `Create listing`.
6. `[P2]` If `EncryptionKeys[creator]` does not yet exist on-chain, the frontend generates an x25519 keypair, persists the private half to sandbox local-storage, and submits `batch_all([register_encryption_key, create_listing])` instead of a plain `create_listing`. Otherwise it submits `create_listing` directly.
7. Inline checklist runs (see §5.3 Section D).
8. On success, lands on `/listing/:new_id`.
   - **Phase 1:** state 2 with a `Your listing` badge.
   - **`[P2]`:** state 5 (in-memory content-lock-key playback) while the content-unlock-service writes `WrappedKeys[(listing_id, creator)]` in the background; once the subscription fires, the page quietly promotes to state 4. No visible transition if the creator plays before the wrapped key lands.

### 6.2 First purchase (new buyer)

`[P2]` — in Phase 1 this is identical to §6.3 Repeat purchase.

1. Buyer clicks `Buy for X DOT` on a listing.
2. Frontend checks sandbox local-storage for an x25519 session keypair. None found. Generates one and persists the private half.
3. Frontend submits `pallet-utility::batch_all([register_encryption_key(pub), purchase(listing_id)])` via the Triangle host. The mobile host shows one signature request covering both calls.
4. After the block finalizes, the page transitions through states 3 → 4:
   - The pallet emits `PurchaseCompleted(listing_id, buyer, creator)`.
   - The content-unlock-service daemon observes the event, unseals the content-lock-key with `SVC_PRIV`, re-wraps it to the buyer's registered x25519 pubkey, submits `grant_access(listing_id, buyer, wrapped_key)`.
   - The frontend's `WrappedKeys[(listing_id, buyer)]` subscription fires.
   - Client-side decryption completes; integrity check passes; the player appears.

### 6.3 Repeat purchase (existing buyer)

1. Buyer clicks `Buy for X DOT`.
2. `[P2]` Frontend finds the existing x25519 keypair in sandbox local-storage; skips `register_encryption_key`.
3. Frontend submits `purchase(listing_id)` as a single call via Triangle. One signature request.
4. After the block finalizes:
   - **Phase 1:** the page transitions straight to state 2. Playback begins.
   - **`[P2]`:** the page transitions through states 3 → 4 via the content-unlock-service grant flow, same as §6.2 step 4.

### 6.4 Watch purchased content

1. Buyer navigates to `/purchases` or directly to `/listing/:id`.
2. If already purchased, state 2 (P1) or state 4 (P2) renders.
3. The page computes `blake2b-256(plaintext)` and compares against `Listing.content_hash`; surfaces the verified-content indicator.
4. Buyer plays inline with the native `<video>` element. Optionally downloads via the Download button.

### 6.5 Browse as a creator

A creator finds their own listings by using Browse like any other user. There is no "My Listings" view. When the creator clicks their own listing:

- **Phase 1:** state 2 with a `Your listing` badge. Plaintext plays directly from Bulletin.
- **`[P2]`, same session as upload:** state 5 — plays from the in-memory content-lock-key retained by the upload flow.
- **`[P2]`, any other session:** state 3 until the content-unlock-service has written `WrappedKeys[(listing_id, creator)]`, then state 4 with the `Your listing` badge. This is the same path a buyer uses; no divergent code.

## 7. States and edge cases

### 7.1 Loading

- Storage-backed views (`Browse`, `My Purchases`) render skeleton cards until the initial fetch completes.
- Listing detail renders a shell (title/price placeholders, a blurred thumbnail) until `Listings[id]` resolves.
- Inline operations inside flows (upload, purchase) use in-place status checklists rather than blocking spinners.

### 7.2 Empty

- **Browse:** "No listings yet." with a link to `/create`.
- **My Purchases:** "You haven't bought anything yet." with a link to `/`.

### 7.3 Errors

- **Insufficient funds on purchase** — inline message under the Buy button: "Not enough DOT. Balance: X, needed: Y." Button disabled.
- **Double-purchase attempt** — not reachable from the UI: once purchased, the Buy button is replaced by the `✓ Purchased` badge. If somehow submitted, the pallet returns a dispatch error that surfaces as an inline toast.
- **Creator tries to buy own listing** — not reachable from the UI: the creator sees state 5, which has no Buy button.
- **Listing not found** — state shown at `/listing/:id` when `Listings[id]` is empty.
- **Bulletin fetch failure** — inline retry in the media area: "Couldn't reach content storage. Retry."
- **`[P2]` content-unlock-service delay / outage** — state 3 ("Preparing your content…") is the indefinite waiting state. No explicit timeout in the UI; documented in `gaps.md` as the "content-unlock-service single point of failure" gap. If operators know the daemon is down, they surface it manually.
- **`[P2]` integrity-check mismatch** — player replaced with "⚠ Content failed integrity check." No retry; the listing itself is broken on-chain (documented as the "no consistency check between creator-submitted fields" gap).
- **Create-listing signing rejected / failed tx** — the signing step in the checklist flips red; Retry re-submits from that step.

### 7.4 Explicitly out of scope

- Session-key loss recovery. Not surfaced in the UI at all. Per spec, the demo account is assumed to keep its session key intact.
- Pagination, search, sort, and filters on Browse.
- Creator purchase/revenue stats.
- Editing or deleting a listing.
- Profile pages, favorites, subscriptions, notifications.

## 8. Phase 1 vs Phase 2 — summary of deltas

Every view listed in §5 exists in both phases. The deltas are narrow:

| Area | Phase 1 | Phase 2 |
|---|---|---|
| Create flow — checklist | No encryption or sealing steps | Adds `Generating content-lock-key`, `Encrypting content`, `Sealing content-lock-key to SVC_PUB` |
| Create flow — session keypair | N/A | x25519 keypair generated client-side on first listing creation (or first purchase, whichever comes first); private half persisted to sandbox local-storage |
| Create flow — content-lock-key | N/A | Retained in memory for the current session only; not persisted |
| First listing creation | Plain `create_listing` | `batch_all([register_encryption_key, create_listing])` if `EncryptionKeys[creator]` is missing |
| First purchase | Plain `purchase` | `batch_all([register_encryption_key, purchase])` if `EncryptionKeys[buyer]` is missing |
| Listing detail state 3 | Does not exist | "Preparing your content…" while polling `WrappedKeys` |
| Listing detail state 4 | Replaced by state 2 | Client-side unseal + decrypt before render; applies to both buyers and creators |
| Listing detail state 5 | Identical to state 2 plus `Your listing` badge | Same-session post-upload fast-path: creator plays via in-memory content-lock-key instead of waiting for the wrapped key |

## 9. Spec updates required

All three spec updates from the initial brainstorming have been applied to `spec.md`:

1. **Listing struct — thumbnail CID** (`thumbnail_cid: BulletinCid`), always unencrypted, auto-extracted from the video on upload.
2. **Creator playback unified with buyer decryption** — the content-unlock-service also observes `ListingCreated` and writes `WrappedKeys[(listing_id, creator)]`. Creator playback uses the same decryption flow as a buyer. Requires first-ever listing creation to batch `register_encryption_key` with `create_listing`. The frontend retains the plaintext content-lock-key in memory for the current session as a fast-path for immediate post-upload playback (no local-storage persistence keyed by `listing_id`).
3. **Flipped `Purchases` key order** — `StorageDoubleMap<AccountId, ListingId, ()>`. Enables a cheap prefix scan for "my purchases."

## 10. Known limitations (frontend-specific)

These are acceptable for the PoC and are listed so they are not lost.

- **Container compatibility.** Videos whose container the browser cannot play inline (`.avi`, `.mkv`, some `.mov` variants) fall back to a download button. The demo controls the source file and uses MP4.
- **No listing indexer.** Browse iterates all listings client-side; My Purchases iterates all purchases for the current account. Fine at demo scale; a production deployment would need an indexer.
- **No session-key recovery.** If the buyer's x25519 private key is lost from sandbox local-storage, all past Phase 2 purchases become undecryptable. Out of scope until Phase 4. The demo operator is assumed to not clear storage.
- **No listing mutability.** Matches the pallet. Once listed, title, description, price, thumbnail, and content are immutable.
