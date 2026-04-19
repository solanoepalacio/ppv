# Content Registry Pallet

A FRAME pallet for a pay-per-view content marketplace. Stores listings with content metadata, handles payment transfers, and records purchases.

## Dispatchables

- `create_listing(content_cid, content_hash, title, description, price, locked_content_lock_key) -> ListingId` — Publishes a listing. Price must be > 0. The `locked_content_lock_key` is empty in Phase 1; in Phase 2 it carries a content-lock-key sealed to the chain-service public key.
- `purchase(listing_id)` — Transfers `price` from buyer to creator and records the purchase. Fails if the buyer is the creator or the buyer has already purchased this listing.

## Source Layout

| File | Purpose |
|---|---|
| `src/lib.rs` | Pallet storage, config, calls, events, and errors |
| `src/weights.rs` | Auto-generated weight functions from benchmarks |
| `src/benchmarking.rs` | Benchmark definitions for dispatchables |
| `src/mock.rs` | Mock runtime used by unit tests |
| `src/tests.rs` | Unit tests |

## Commands

```bash
# Check compilation
cargo check -p pallet-content-registry

# Run unit tests
cargo test -p pallet-content-registry

# Run benchmarks
cargo test -p pallet-content-registry --features runtime-benchmarks
```

See [`../../README.md`](../../README.md) for full blockchain build and run instructions.
