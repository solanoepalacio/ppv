# Why ppview's content-unlock-service is an external daemon, not an offchain worker

The `pallet-content-registry` design calls for a trusted off-chain component that observes `PurchaseCompleted` / `ListingCreated` events, unseals a content-lock-key encrypted to `SVC_PUB` (x25519), re-seals it to the buyer's or creator's x25519 pubkey, and submits a signed `grant_access` extrinsic.

A substrate offchain worker (OCW) would be a natural fit for this shape — it already has keystore access, event awareness via runtime storage, and a sanctioned path for submitting signed extrinsics. The reason ppview runs this logic as an external Rust daemon (subxt) instead comes down to a single hard blocker in the current `polkadot-sdk`: **OCWs cannot perform x25519 seal/unseal with stock components.** The sections below document the evidence.

## 1. The keystore is schema-locked

`substrate/primitives/keystore/src/lib.rs` (lines 66–300) defines the full `Keystore` trait surface. It exposes only `sr25519_*`, `ed25519_*`, `ecdsa_*`, `bandersnatch_*`, and `bls381_*` methods. There is no `x25519_public_keys`, `x25519_generate_new`, or `x25519_sign`.

`substrate/primitives/core/src/` confirms this at the primitive level: files exist for `sr25519.rs`, `ed25519.rs`, `ecdsa.rs`, `bandersnatch.rs`, and `bls.rs` — no `x25519.rs`. No `Pair` implementation for x25519 exists anywhere in the SDK.

## 2. The keystore is signing-only

Even for the schemes it does support, the keystore exposes only `*_public_keys`, `*_generate_new`, and `*_sign`. No method returns the underlying `Pair` or the raw secret bytes. This means a pallet cannot load a key from the keystore and use it for an arbitrary cryptographic operation like ECDH or asymmetric decryption — the key material never leaves the host.

## 3. The OCW sandbox blocks side-channel key loading

`sp_io` does not expose file I/O or environment access to OCWs. The only non-deterministic host-function surfaces are `http_request_*` and `local_storage_*`. Getting an x25519 private key into an OCW therefore requires either:

- an HTTP round-trip to a process that holds the key (which just reintroduces an external daemon), or
- pre-seeding the key into OCW local storage out-of-band **and** implementing x25519 inside the wasm runtime itself.

The second option is not viable with stock dependencies — `x25519-dalek` does not compile into `sp-io`, and adding it would require a custom SDK fork plus a new primitive crate.

## 4. The ed25519 → x25519 bridge exists in the tree but is inaccessible

`substrate/primitives/statement-store/src/ecies.rs` already contains the exact primitive one would want: it takes an ed25519 seed, SHA-512-hashes it into an `x25519_dalek::StaticSecret`, and provides `encrypt_ed25519` / `decrypt_ed25519` helpers. In principle, this would let a pallet re-use a keystore ed25519 key as an x25519 key.

Three separate things in upstream `sp-statement-store` make this unusable from a pallet OCW:

- the `ecies` module is declared `mod ecies;` (private, not re-exported);
- it is gated on `#[cfg(feature = "std")]`, so it is not part of the wasm runtime;
- the `decrypt_ed25519` entry point takes an `ed25519::Pair` by reference, and the keystore does not hand out the `Pair`.

All three would have to change upstream to make this path viable. That is a fork-and-patch undertaking, not a local design decision.

## 5. No other FRAME hook helps

`on_initialize`, `on_finalize`, and `on_idle` are deterministic on-chain hooks. They have no access to secrets, no non-deterministic host functions, and no keystore. `offchain_worker` is the only FRAME hook with the capability surface (keystore + `sp_io::offchain`) one would need — and it is the hook blocked by the four points above.

## Consequence for ppview

The content-unlock-service is implemented as a standalone Rust binary using `subxt`, co-located with the parachain collator. It holds `SVC_PRIV` as a `chmod 600` key file outside the Substrate keystore, and signs `grant_access` with a separate sr25519 service-account key — also outside the keystore, since the daemon is an external process rather than a node plugin. The pallet authorizes it via a custom `ServiceOrigin` (see `docs/design/spec.md` §4) that checks the signer against the genesis-set `ServiceAccountId`.

A hybrid design (OCW handles events and extrinsic submission; a minimal localhost sidecar does the x25519 crypto) is technically feasible but offers no meaningful simplification: `SVC_PRIV` still lives in an external process, and the only thing removed is the sr25519 service-account key file. The hybrid trades one key file for an IPC boundary and a second deployed component, with no security gain.

If a future `polkadot-sdk` release ships a first-class x25519 `Pair` + keystore surface (or exposes `sp-statement-store::ecies` to wasm), ppview's content-unlock-service can collapse into a pallet OCW without design changes elsewhere — the on-chain shape (`ServiceOrigin`, `grant_access`, `WrappedKeys`) is already compatible.
