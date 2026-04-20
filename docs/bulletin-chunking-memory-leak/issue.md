# Bulletin chunked-upload memory leak

Investigation writeup for a renderer-crashing memory leak in the chunked-upload
path of `@parity/bulletin-sdk`. Written as an issue-ready summary: reproduction,
what was ruled out, what the remaining hypothesis is, and where to look next.

## Symptom

Uploading a file larger than the SDK's `chunkingThreshold` (default 2 MiB) from
a browser tab crashes the Chrome renderer with "Aw, Snap! Error code: SIGILL"
after ~25 s of upload activity. Files at or below the threshold (single-tx
path) are unaffected.

The SIGILL surface is Chrome's generic "renderer abnormally exited" mapping.
The underlying signal is V8's `FatalProcessOutOfMemory` — the JS heap hits
~3.26 GiB (close to V8's ~4 GiB old-space limit on 64-bit Chrome) and the
process is aborted. This is NOT a WASM panic in `@polkadot/wasm-crypto` or
anywhere else; see §"What was ruled out" below.

## Reproduction

- App: this repo's `web/` at Vite dev (`npm run dev`).
- Upload the 12 MB video at `/home/solano/Downloads/VID_20260412_175204598.mp4`
  via `/create` → drop video → pick thumbnail → fill metadata → Create listing.
- Thumbnail uploads fine (single-tx). Content upload begins, the JS heap climbs
  linearly at ~125 MiB/s with no GC relief, and the tab crashes ~25 s in.

A 1.151 MiB video (`/home/solano/Downloads/test-small.mp4`, generated with
ffmpeg) works as a control: single-tx path, no chunking, no leak.

The leak reproduces on both `@parity/bulletin-sdk@0.1.0` and `0.2.0`. 0.2.0
changed the chunked-path `waitFor` default from `"finalized"` to `"in_block"`,
which shortens per-chunk subscription lifetimes and delays the crash slightly,
but does not bound memory.

## Evidence

Collected from a Chrome DevTools Performance trace
(`Trace-20260420T090132.json`, 81 MB, 92.65 s span, renderer pid 1350387,
317,632 events).

### Renderer `jsHeapSizeUsed` timeline

| t+ | JS heap | Phase |
|---|---|---|
| 0–20 s | ~34 MiB | Page load / idle |
| 20–27 s | 30 → 98 MiB | Thumbnail upload (small single-tx), GC recovers |
| 33–43 s | 20 → 140 MiB | `getContentHash(videoBytes)` on the 12 MB video |
| ~48 s | 150 MiB | **Chunked upload begins** |
| 48–76 s | **150 → 3,185 MiB, linear, ~125 MiB/s, no GC relief** | Leak phase |
| ~77 s | ≥ 3,260 MiB peak | Renderer dies (V8 `FatalProcessOutOfMemory`) |

V8's default old-space limit on 64-bit Chrome is ~4 GiB. Renderer hit ~3.26 GiB
and was aborted.

### CPU-profile hot frames (501,257 samples)

- **18.8 s** cumulative in nested `send` frames:
  `polkadot-api-polkadot-sdk-compat.js → polkadot-api_ws-provider_web.js → chunk-*.js → native WebSocket.send`.
  `polkadot-sdk-compat` wraps every RPC through multiple `send` stages before
  hitting the socket.
- **2.9 s** in `jsonRpcMsg` (JSON-RPC parse on incoming messages).
- **~1 s** in `getValidateTxArgs` + `toHex` / `fromHex` (hex-encoding call
  data; each 1 MiB chunk becomes a ~2 MiB hex string per RPC call).
- **~0 s** in blake2b / wasm-crypto.

### Supporting signals

- `V8.ExternalMemoryPressure` fired 104 times during the leak phase.
- `Major concurrent marking rescheduled` and `V8.GC_MC_*` events dominated the
  back half of the trace — GC ran constantly and could not reclaim.
- No `wasm` / `trap` / `panic` / `abort` events with a crash signature. The
  only `onAbort` events are `@polkadot-api/substrate-client`'s routine
  `AbortSignal` handler (`abortablePromiseFn`); those are normal cancellations.

## What was ruled out

### WASM panic in `@polkadot/wasm-crypto`

Originally suspected because of the SIGILL mapping. The trace shows zero
cumulative time in `blake2b` or any `wasm-crypto` frame, and no `wasm` /
`trap` / `abort` events with a crash signature. Pure-JS blake2b would only
change where hashing runs; it does not touch the RPC pipeline that actually
leaks. Discarded.

### `@parity/bulletin-sdk`'s `storeChunked` loop

Tested directly with a Node vitest that drives `AsyncBulletinClient.store()`
against a fake `BulletinTypedApi` whose `signSubmitAndWatch` observable
synchronously emits `txBestBlocksState { found: true }` and completes. The
test harness exercises the full chunked path — `BulletinPreparer.prepareStoreChunked`,
the for-loop over `prepared.chunks`, per-chunk `createStoreTx` + signing, and
the progress-callback plumbing — but skips the real RPC stack.

Result for N=32 (32 MiB simulated upload, 1 MiB chunks), measured around
`forceGc(); process.memoryUsage().heapUsed; ...; forceGc()`:

```
[memory-test] N=32, chunks reported=32, delta=0.2 MiB, budget=8.0 MiB
```

Retained heap delta is 0.2 MiB — O(1) in the chunk count. The SDK-internal
code is not the retainer. Test harness available at `test/unit/chunked-upload.memory.test.ts`
in a scratch branch (not upstreamed).

The in-repo handoff doc's candidate list included `signAndSubmitWithProgress`'s
closure retention (`tx`, `progressCallback`, `txHash`, `subscription`, timer)
and `prepareStoreChunked`'s upfront `chunks[]` array. Neither shows up in the
isolated harness; both hypotheses are invalidated as dominant retainers.

### `waitFor` default

`waitFor: "finalized"` keeps a chunk's subscription live through at least one
finalization cycle (~10–20 s on Paseo), overlapping with the next chunk's
submission. `@parity/bulletin-sdk@0.2.0` changed the chunked-path default to
`"in_block"`. Browser retest with the 0.2.0 build linked locally still crashed.
The change shortens subscription lifetimes but does not bound memory — the
leak is upstream of the subscription lifecycle.

## Remaining hypothesis: polkadot-api RPC pipeline

Every piece of surviving evidence points downstream of the SDK — into
`polkadot-api` itself:

- The 18.8 s CPU concentration in `polkadot-sdk-compat` → `ws-provider-web` →
  `WebSocket.send` is the pipeline doing work the SDK never touches directly.
- `V8.ExternalMemoryPressure` firing 104× suggests external-backed buffers
  (ArrayBuffers from WebSocket frames, hex-encoded JSON-RPC bodies) are
  accumulating faster than they can be released.
- `jsonRpcMsg` parse cost indicates heavy incoming traffic (block / event
  subscriptions, validation results, state-hash queries), each parsed message
  allocating a new object graph that something is retaining.
- The SDK-isolated test harness retaining ~0 MiB across the same N means
  there is nothing in the SDK's own code path that scales with N.

Suspected retainers, in rough order of likelihood:

1. **`ws-provider-web`'s pending-RPC map.** Entries keyed by request ID are
   (presumably) deleted only on response. With many concurrent block / event
   subscriptions plus per-chunk `system_accountNextIndex`, `chain_getBlockHash`,
   `state_call TransactionPaymentApi_query_info`, `author_submitAndWatchExtrinsic`,
   and friends, the pending map grows.
2. **`polkadot-sdk-compat`'s layered `send` wrappers** capturing outgoing
   messages in closures. The 18.8 s CPU bottom-frame concentration comes
   directly from this layering; whatever state those closures capture scales
   with per-chunk traffic.
3. **The RxJS observable chain behind `signSubmitAndWatch`.** `share` /
   `multicast`-style replay operators can buffer emitted values until all late
   subscribers finish. If the SDK's subscription doesn't fully unsubscribe
   (or the Observable doesn't complete), buffered events pile up. The SDK
   does call `subscription.unsubscribe()` in its `cleanup()`, but that doesn't
   guarantee the upstream PAPI observable has released its internal state.

(1) and (2) are the strongest candidates. The fact that ~125 MiB/s of linear
growth matches roughly the data-plus-hex-encoded-RPC traffic rate (1 MiB
chunks × ~2 MiB hex bodies × multiple `send` stages per tx) is consistent with
retained outbound message bodies.

## How to investigate further

This is no longer a `@parity/bulletin-sdk` bug. The next investigation step
belongs in `polkadot-api` (`https://github.com/polkadot-api/polkadot-api`),
ideally with this evidence attached.

Suggested progression:

1. **Reproduce in Node**, without the browser, using the real polkadot-api
   plus a mock ws-provider that echoes canned responses at controlled latency.
   Drive `signSubmitAndWatch` directly (no bulletin-sdk) for N = 100 fake
   extrinsics of size ~1 MiB and assert bounded `process.memoryUsage().heapUsed`
   after `global.gc()`. This isolates the leak to polkadot-api independent of
   any SDK on top.
2. **Bisect the layers** by swapping out components:
   - Raw `ws-provider-web` alone, sending bulk `system_version`-style RPCs.
     If this retains memory, the bug is in the provider.
   - `ws-provider-web` + `polkadot-sdk-compat`, same workload. If this retains
     and the previous didn't, the wrapper layer retains.
   - Full `createClient` + `signSubmitAndWatch` with fake signer. If this
     retains and the previous didn't, the tx-observable chain retains.
3. **Inspect heap snapshots** at the steady-state peak. V8 heap snapshots
   taken mid-leak should show what type of object dominates the retained set —
   `Uint8Array`, `String` (hex), or specific polkadot-api / RxJS classes.

A workaround that doesn't require an upstream fix (but wasn't tried before
stopping here) is to switch the SDK's chunk submission from
`tx.signSubmitAndWatch(signer).subscribe(...)` to `tx.signAndSubmit(signer)`
(Promise-based), which resolves on finalization without exposing the RxJS
subscription chain. This may or may not help — the retention may live inside
polkadot-api whether you subscribe to the observable or not — but it's the
smallest possible SDK-level change worth trying before pushing upstream.

## Workaround currently in place

`web/src/hooks/useBulletinUpload.ts` throws on any upload above
`MAX_UPLOAD_BYTES` (set conservatively at or below the SDK's 2 MiB
`chunkingThreshold`) so every upload uses the single-tx signed path and
never enters the chunked pipeline. `web/src/pages/CreatePage.tsx` rejects
oversize files at pick time. This is a Phase 1 PoC limitation for the PBP
demo; tracked in the memory note `project_bulletin_upload_size.md`.

## References

- SDK source inspected: `@parity/bulletin-sdk@0.2.0` at
  `https://github.com/paritytech/polkadot-bulletin-chain` (`sdk/typescript`).
  Relevant files: `src/async-client.ts` (`storeChunked`,
  `signAndSubmitWithProgress`), `src/preparer.ts` (`prepareStoreChunked`),
  `src/chunker.ts` (`FixedSizeChunker`).
- polkadot-api: `https://github.com/polkadot-api/polkadot-api` — ws-provider,
  polkadot-sdk-compat, and substrate-client live here.
- Raw trace (local only, not committed): `Trace-20260420T090132.json`.
