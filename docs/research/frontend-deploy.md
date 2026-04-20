# polkadot-stack-template `deploy-frontend.yml` — end-to-end trace

> Source: `polkadot-stack-template/.github/workflows/deploy-frontend.yml` plus the template's own `docs/DEPLOYMENT.md`/`docs/TOOLS.md`, **and** the `paritytech/dotns-sdk` reusable workflow fetched via `gh api` (verified 2026-04-17).
> Cross-reference: `host-api-example/.github/workflows/dotns-deploy.yml` (sibling repo that uses the same reusable workflow).

---

## REVERSAL — 2026-04-20 — back to Bulletin for Phase 1c

After re-reviewing with classmates' feedback (the stock CI path "just works"), the prior decision to favour IPFS was reversed. Phase 1c uses the **Bulletin + DotNS CI path** as-is; the ~14-day retention is handled operationally by re-running the action before each demo. Canonical statement lives in `docs/design/spec.md` §7. The sections below are preserved for historical context and describe the IPFS-preferring decision that we no longer follow.

---

## CORRECTION — 2026-04-17 — prior conclusion was wrong

The initial version of this doc stated "the bundle is uploaded to IPFS, NOT to Bulletin Chain." **That was wrong.** After the sandbox gained `gh api` access, we fetched the reusable workflow at `paritytech/dotns-sdk/.github/workflows/deploy.yml@main` and the composite actions it calls. The verified truth:

- **The CI path uploads to Bulletin Chain.** In `paritytech/dotns-sdk/.github/workflows/deploy.yml`, the step `Upload to Bulletin` invokes `./.github/actions/bulletin`, which shells out to `dotns bulletin authorize <address>` and `dotns bulletin upload <build-path>`. The `dotns` CLI lives in `paritytech/dotns-sdk/packages/cli/`. Before uploading, the workflow optionally packages the bundle as a single CAR file using IPFS Kubo (`ipfs add -Q -r --cid-version=1 --raw-leaves --pin=false ./build` → `ipfs dag export "$CID" > build.car`) — this gives a deterministic CID and lets the Bulletin upload be a single-file operation. Bulletin handles the chunking internally.
- **DotNS then points the `.dot` domain at the returned CID** via `./.github/actions/dotns` (`dotns content set $DOMAIN $CID`).
- **The local script `scripts/deploy-frontend.sh` (line 34: `w3 up ...`) is a separate, simpler manual path that uses w3.storage instead.** The original research conflated the two.

### Design decision (ppview) — use IPFS, NOT Bulletin

Bulletin Chain has a **~14-day retention** (`TransactionStorage` expiry). Re-uploading the frontend every two weeks is operational overhead we don't want for the PoC demo window. IPFS (via w3.storage or equivalent) persists without active renewal and is still Polkadot-native where it matters (DotNS resolves the `.dot` domain to the IPFS CID).

For ppview we therefore use the **local `scripts/deploy-frontend.sh`** path as the reference (w3.storage IPFS upload + manual DotNS content-hash set) and do NOT adopt the CI reusable workflow's Bulletin path. DotNS registration/contenthash update still uses the same `dotns` CLI operations.

If we ever want to switch to Bulletin, the reusable workflow is drop-in — but renewal would need to be solved first.

---

## (a) Where the bundle ends up — definitive answer (historical, superseded by correction above)

Original claim (partially correct, partially wrong):
- Correct: `scripts/deploy-frontend.sh` uploads to w3.storage IPFS.
- Wrong: the CI `deploy-frontend.yml` + reusable `paritytech/dotns-sdk/deploy.yml` path was claimed to also use IPFS. It actually uses Bulletin Chain via the `dotns bulletin upload` CLI command.

Bulletin Chain in the template is used in two places (we had been conflating them):
1. **Bundle hosting** — via the CI reusable workflow. (This is what we initially missed.)
2. **Runtime user uploads** — `web/src/hooks/useBulletin.ts` connects to `wss://paseo-bulletin-rpc.polkadot.io` and calls `TransactionStorage.store()` for file uploads made by users of the running frontend.

---

## (b) Workflow flow, step by step with line refs

### `deploy-frontend.yml` (four jobs, sequential)

**Job 1 — `check`** (`lines 29-48`)
- `actions/checkout@v4`.
- Computes a source hash over `git ls-files web/ .github/workflows/deploy-frontend.yml | xargs sha256sum | sha256sum` (line 40).
- Uses `actions/cache@v4` with `lookup-only: true` keyed on `deployment-${hash}` to short-circuit re-deploys when nothing relevant changed.

**Job 2 — `build`** (`lines 50-84`, gated on `needs.check.outputs.cache-hit != 'true' || inputs.skip-cache`)
- `actions/setup-node@v4` with `node-version: 22`, npm cache on `web/package-lock.json`.
- `npm ci` in `web/`.
- Caches `web/dist` keyed on the source-hash.
- `npm run build` (only if build cache miss).
- `actions/upload-artifact@v4` — uploads `web/dist` as artifact name **`frontend-build`** with `retention-days: 1`.

**Job 3 — `deploy`** (`lines 86-101`)

```yaml
uses: paritytech/dotns-sdk/.github/workflows/deploy.yml@main
with:
  basename: ${{ inputs.basename }}
  mode: production
  artifact-name: frontend-build
  register-base: true
  skip-cache: ${{ inputs.skip-cache || false }}
  max-retries: 3
secrets:
  dotns-mnemonic: ${{ secrets.DOTNS_MNEMONIC || 'bottom drive obey lake curtain smoke basket hold race lonely fit walk' }}
```

- Inputs passed: `basename` (the `.dot` domain), `mode: production`, `artifact-name: frontend-build` (matches job 2's upload), `register-base: true` (tells the SDK to register the base `.dot` name if it isn't already), `skip-cache`, `max-retries: 3`.
- Single secret: `dotns-mnemonic` — the sr25519 mnemonic that signs the DotNS registration/update extrinsics on Paseo. Falls back to **Alice's well-known dev phrase** (`bottom drive obey lake curtain smoke basket hold race lonely fit walk`) which works on Paseo testnet for free registration. Comment on line 100-101 spells this out.
- The reusable workflow itself lives at `paritytech/dotns-sdk/.github/workflows/deploy.yml@main`. I could not fetch it from the sandbox (`gh`, `curl`, and `WebFetch` all denied). What we know about it from the contract surface and cross-repo usage:
  - It downloads the `frontend-build` artifact (`actions/download-artifact@v4` style).
  - It uploads the artifact directory to IPFS. The local mirror script in the same template (`scripts/deploy-frontend.sh`, lines 17-42) uses `@web3-storage/w3cli` with `w3 up --no-wrap`. The CI reusable workflow is almost certainly doing the same flow (`w3 up` or `@web3-storage/w3up-client`) to produce a CID, since it outputs `cid` (visible in `host-api-example/.github/workflows/dotns-deploy.yml` line 173: `${{ needs.deploy-preview.outputs.cid }}`).
  - It then submits extrinsics to Paseo's DotNS system pallet to (a) register the basename if `register-base: true` and not already registered, and (b) set the content hash for `<basename>.dot` (and optional subname) to the IPFS CID.
  - Outputs produced: `cid`, `fqdn`, `url` (confirmed by `host-api-example` lines 171-173: `needs.deploy-preview.outputs.{fqdn,url,cid}`).

**Job 4 — `post-deploy`** (`lines 103-116`, only runs if deploy succeeded)
- Writes `.deployment-marker` file.
- Saves it to the cache keyed `deployment-${hash}` — this is what job 1's `lookup-only` cache check reads on the next run to skip redundant deploys.

### `scripts/deploy-frontend.sh` (local mirror, not invoked by CI)

This is the manual/local pathway documented in `docs/DEPLOYMENT.md` lines 55-67. It exists as a dev convenience, not as part of CI.

- Line 13-15: `npm install && npm run build` in `web/`.
- Line 18: checks for `w3` in PATH, errors out with install instructions if missing.
- **Line 34**: `CID=$(w3 up "$ROOT_DIR/web/dist" --no-wrap 2>&1 | grep -oE 'bafy[a-zA-Z0-9]+' | head -1)` — uploads to w3.storage IPFS.
- Line 42: prints `https://$CID.ipfs.w3s.link` gateway URL.
- Lines 44-55: DotNS is NOT touched by this script — it prints manual follow-up instructions pointing at dotns.app UI, or recommends running the CI workflow.

### Endpoint summary

| Step | Endpoint / service |
|---|---|
| npm build | local/GitHub Actions runner |
| Artifact upload | GitHub Actions artifact storage (transient, 1-day retention) |
| IPFS pin (CI) | w3.storage (`api.web3.storage`, `*.ipfs.w3s.link`) — inferred from local script + CID format |
| IPFS pin (local) | w3.storage (confirmed: `scripts/deploy-frontend.sh:34`) |
| DotNS domain registration / content-hash update | **Paseo relay chain** — via `paritytech/dotns-sdk` (signed by `dotns-mnemonic`) |
| Bulletin Chain | **Never touched by this workflow.** Only used at runtime from inside the frontend via `web/src/hooks/useBulletin.ts` against `wss://paseo-bulletin-rpc.polkadot.io` |

---

## (c) Secrets and inputs required

### Workflow inputs (`workflow_dispatch` only — this is a manual workflow)

| Input | Type | Default | Purpose |
|---|---|---|---|
| `basename` | string | `polkadot-stack-template00` | The `.dot` basename to register/update. Must be lowercase, 9+ letters then exactly 2 digits (e.g. `my-cool-project42`). Enforced by DotNS registrar. |
| `skip-cache` | boolean | `false` | Bypasses the source-hash cache to force a redeploy even if the source hasn't changed. |

### Secrets

| Secret | Required? | Purpose | Default fallback |
|---|---|---|---|
| `DOTNS_MNEMONIC` | No (in template) | sr25519 mnemonic for the account that signs the DotNS extrinsics on Paseo. Must have funds on Paseo to register/update if not using Alice. | Alice dev phrase (works for free registration on Paseo testnet only). |

That is **the only secret this workflow reads.** In particular:
- No `W3_TOKEN` / `WEB3_STORAGE_TOKEN` secret is referenced in the caller workflow. The w3.storage upload credential must therefore be embedded inside the reusable workflow (likely a GitHub OIDC-authenticated w3up login owned by Parity's `paritytech/dotns-sdk` org, or a hardcoded anonymous upload). This is an open question worth resolving before lifting — if we fork the reusable workflow we may need to supply our own w3.storage credentials.
- No Bulletin-related secrets.

### Permissions required on the calling job

```yaml
permissions:
  contents: read
  statuses: write
  id-token: write      # suggests OIDC is used somewhere downstream — plausibly for w3up login
  pull-requests: write
```

The `id-token: write` permission is a strong hint that the reusable workflow uses OIDC to authenticate with w3.storage (w3up supports GitHub-OIDC-based delegation), which would explain the absence of a `W3_TOKEN` secret in the caller.

---

## (d) How to lift for ppview

### Hard problem up front: our spec requires Bulletin-hosted frontend; this workflow uploads to w3.storage IPFS. The template does not show how to host a frontend bundle on Bulletin Chain at all.

There are three practical paths:

**Path A — adopt the template workflow as-is (IPFS+DotNS), revisit Bulletin hosting later.** Lowest risk. We get a working `.dot` domain pointing at an IPFS bundle in an afternoon. Violates the program's "hosted on Bulletin Chain" requirement but gets everything else working. Inputs to change:
- `basename` default (pick ppview's `.dot` name, e.g. `ppview00` — must match the 9+letters-2-digits rule).
- `DOTNS_MNEMONIC` secret (same mnemonic we use for parachain deploys is fine for Paseo).
- Nothing else — `artifact-name`, `build` job, cache logic all work unchanged for a Vite React SPA.

**Path B — fork / replace the reusable workflow to upload the bundle to Bulletin Chain in chunks.** This is the spec-compliant path and does not exist in the template. What we have to build:
- Bulletin Chain's `TransactionStorage.store()` caps at **8 MiB per transaction**. A production React+Tailwind+PAPI bundle after `vite build` is typically 500 KB – 3 MB gzipped per chunk but the assets directory (images, fonts, lazy chunks) can easily exceed 8 MiB. We need a manifest/chunking scheme: split `dist/` into 8 MiB blobs, upload each via `TransactionStorage.store()`, record their CIDs, and publish a root manifest (itself under 8 MiB) that lists `{ path, cid, size }` for every file. Client-side, an edge gateway or a small bootstrap HTML stub would fetch the manifest and then fetch each file from `https://paseo-ipfs.polkadot.io/ipfs/{cid}`.
- Critically: Bulletin Chain auto-pins stored data to IPFS (that's the point of the chain), so the CIDs ARE resolvable through the Paseo IPFS gateway. We can piggyback on the existing IPFS gateway infrastructure rather than hitting a Bulletin-specific HTTP endpoint.
- Pre-compute CIDs deterministically from file hashes (blake2b-256 → CIDv1 raw, 0x55/0xb220) using the same pattern as `web/src/utils/cid.ts`. This lets DotNS be pointed at the root-manifest CID *before* the Bulletin upload finalizes.
- Auth requirement: the signing account must be authorized on Bulletin Paseo (self-service faucet at `paritytech.github.io/polkadot-bulletin-chain`), and the allowance must cover both transaction count and byte count for the full chunked bundle.
- Renewal: data expires ~7 days (100,800 blocks). Need either a scheduled CI job that calls `TransactionStorage.renew(cid)` for each chunk, or an on-chain hook. This is not demonstrated anywhere in the template.
- Recommended tooling: the `polkadot-skills:bulletin-sdk` skill / `@parity/bulletin-sdk` JS package is explicitly designed for this (handles chunking and CID derivation correctly). Using the raw pallet the way `useBulletin.ts` does would require reimplementing chunking.

**Path C — hybrid.** Upload the bundle to Bulletin AND register DotNS at the Bulletin-derived root-manifest CID. Same work as Path B, plus we keep the DotNS registration step from Path A (which is just a Paseo extrinsic and is orthogonal to where the bytes actually live — DotNS just stores a content hash / CID).

**Recommendation:** start Path A for Phase 1 (unblocks everything, including iterating on the contract/pallet), then execute Path B/C for the Phase 1 submission to PBP Lisbon. Scope the chunking + renewal logic as a standalone sub-project; it's reusable beyond ppview.

### What to copy verbatim from the template regardless of path

- `.github/workflows/deploy-frontend.yml` structure: the `check` → `build` → `deploy` → `post-deploy` shape with deployment-marker caching is a good pattern to keep.
- The Node 22 + `npm ci` + `web/dist` artifact handoff is unchanged.
- `workflow_dispatch` with a `basename` input — stays the same.
- The fallback-to-Alice trick in `dotns-mnemonic` is fine for early dev on Paseo; replace with our own mnemonic secret before public demo.
- If going Path A, the `uses: paritytech/dotns-sdk/.github/workflows/deploy.yml@main` line is lifted as-is.

### What to build new for Path B

- A `bulletin-upload` step/action that: walks `web/dist/`, chunks to 8 MiB, calls `TransactionStorage.store()` per chunk via PAPI or `@parity/bulletin-sdk`, builds a manifest JSON, uploads the manifest, returns the manifest CID.
- A small runtime "loader" in `index.html` / a service worker that reads the manifest and fetches assets from `https://paseo-ipfs.polkadot.io/ipfs/{cid}` — OR rely on DotNS + a Bulletin-aware gateway if one exists (none documented in the template).
- A weekly `renew` workflow that re-ups each chunk's retention before the ~7-day expiry.

---

## Reconciling the prior research claim

**The prior research doc (`docs/research/polkadot-stack-template.md` §10) is correct.** Specifically, its line 85 ("template uploads to w3.storage IPFS, not Bulletin Chain") matches the code:
- `scripts/deploy-frontend.sh:34` is an unambiguous `w3 up` call.
- The template's own `docs/DEPLOYMENT.md:33-68` describes the DotNS deploy as "IPFS + Polkadot naming", step 2 is literally "Uploads to IPFS", and separately describes Bulletin Chain under a different section (lines 214-256) as a runtime file-upload feature triggered by a UI toggle (`"Upload to IPFS (via Bulletin Chain)"` in the file drop zone).
- `docs/TOOLS.md:99-107` says `deploy-frontend.yml` uses `paritytech/dotns-sdk` and explicitly describes the flow as "builds the frontend, uploads to IPFS, and registers/updates the DotNS domain." Bulletin Chain is listed as a *separate* tool (lines 69-93) for "optional IPFS upload of files before claiming their hash on-chain" — not bundle hosting.
- `web/src/hooks/useBulletin.ts` calls `TransactionStorage.store()` from *within the running frontend* for user-selected files (`FileDropZone.tsx`), not for the bundle.

**The user's claim that "the template actually supports Bulletin Chain deploy" appears to be a misunderstanding** between two distinct uses of Bulletin Chain in the template:
1. Runtime file uploads by end users (supported, lives in `useBulletin.ts`).
2. Static-bundle hosting for the frontend itself (NOT supported — no workflow, script, or code in the template does this).

This is a meaningful gap that needs planning work, not a misread of the template. The prior research was right to flag it as a caveat.

### Calibration note for trust in the rest of the prior research doc

Section 10's specific claim stands up under scrutiny. I did not fact-check every other section of `polkadot-stack-template.md` in this pass, but the authorial care visible in §10 (it includes the w3.storage caveat explicitly and cites `bulletin-sdk` as a likely helper for the gap) suggests the rest of the doc is probably trustworthy. If the user had concrete evidence the template supports Bulletin-hosted frontends (e.g. a commit, a script, a workflow that does `TransactionStorage.store()` over `dist/`), that evidence should be surfaced and re-reconciled — nothing in the current `main` branch of `polkadot-stack-template` does this.

---

## Files referenced (absolute paths)

- `polkadot-stack-template/.github/workflows/deploy-frontend.yml` — the primary workflow.
- `polkadot-stack-template/scripts/deploy-frontend.sh` — local mirror, confirms w3.storage.
- `polkadot-stack-template/docs/DEPLOYMENT.md` — template's own description of the deploy flow and the separate Bulletin runtime-upload feature.
- `polkadot-stack-template/docs/TOOLS.md` — DotNS section (lines 95-107), Bulletin section (lines 69-93).
- `polkadot-stack-template/web/src/hooks/useBulletin.ts` — Bulletin Chain runtime client used from inside the frontend, not from CI.
- `host-api-example/.github/workflows/dotns-deploy.yml` — independent consumer of the same `paritytech/dotns-sdk/.github/workflows/deploy.yml@main`; confirms it outputs `cid`, `fqdn`, `url` and takes the same input contract.
- `ppview/docs/research/polkadot-stack-template.md` §10 (lines 83-86, 104-105, 128) — prior research. Correct.
- `ppview/docs/design/spec.md` line 159 — ppview's Bulletin-hosted frontend requirement.

## Open questions to resolve later (out of sandbox)

- Exact contents of `paritytech/dotns-sdk/.github/workflows/deploy.yml@main` and the underlying upload tool (is it `w3 up`, `@web3-storage/w3up-client`, or something else? Where does the w3.storage credential come from — OIDC, a shared org-level secret, an anonymous endpoint?). This matters if we need to fork or self-host the workflow. Fetching is blocked in the current sandbox; resolve by running `gh api repos/paritytech/dotns-sdk/contents/.github/workflows/deploy.yml` or visiting github.com/paritytech/dotns-sdk in a browser outside this session.
- Whether `paritytech/dotns-sdk` has any Bulletin-Chain mode (unlikely based on naming but worth a glance at its README).
- Whether there is a community-written Bulletin-as-static-host loader/gateway we can reuse before writing our own.
