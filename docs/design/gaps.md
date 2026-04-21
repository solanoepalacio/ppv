# Design Gaps
This document describes existing gaps on the application design and implementation. The goal is not solve these issues, but to acknoledge them.
These gaps are acceptable for a PoC but would require solving if this application was meant to work in production.

## Major Gaps:
1. **No consistency check between creator-submitted fields.** content_cid, content_hash, and locked_content_lock_key are all creator-supplied and uncorrelated on-chain. A creator can list garbage: hash that doesn't match the ciphertext, a locked_content_lock_key that unseals to random bytes, or a CID pointing to unrelated content. The buyer finds out after paying — and there's no refund extrinsic.
2. **Content-unlock-service daemon single point of failure.** If the daemon is down when a purchase is made, the buyer never gets the content they paid for. No retry / replay guarantees beyond the daemon itself being brought back online.
3. **No refund / failure path on the payment side.** Purchase transfers funds atomically, but the grant is asynchronous. If content-unlock-service is down, SVC_PRIV is lost, or Bulletin content has expired (before Phase 4 is implemented), the buyer has paid with nothing to show. No SLA, no dispute, no escrow.

## Minor Gaps:
1. **Listing mutability / takedown.** No update_listing, no delete_listing, no admin override. Price, description, and CID are all permanent.
2. **Content-unlock-service can downgrade a buyer's key.** `grant_access` overwrites any existing `WrappedKeys[(listing_id, buyer)]` entry. A compromised or malicious content-unlock-service could replace a previously-granted wrapped key with a bogus one, effectively revoking paid access. The buyer has no on-chain recourse.
