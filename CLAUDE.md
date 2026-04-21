# ppview — Claude Code context

## Project

Pay-per-view content marketplace on Polkadot. Learning-focused PoC for the **Protocol Builders Program (PBP) Lisbon 2026**. Solo developer. Tight deadline. The goal is to exercise the Polkadot stack, not to ship a viable product.

- Canonical design spec: `docs/design/spec.md`.
- Product-level framing and implementation limitations: `README.md` (owned by the user — don't edit without being asked).
- Original brainstorm (historical, superseded): `pay-per-view.md`.

## Repository structure

- `docs/design/spec.md` — canonical working spec. §1 terminology → §7 deployment model. Treat this as the single source of truth for design decisions. If some decision doesn't match the ideal implementation or is inconsistent with practical findings during development bring it up for the human to review. Design spec *CAN* contain mistakes and room for improvement.
- `docs/research/polkadot-stack-template.md` — structured walkthrough of the PBP-provided stack template.
- `docs/research/triangle-sdk.md` — walkthrough of the Polkadot Triangle SDK and its example app.
- `docs/research/frontend-deploy.md` — trace of the stack template's deploy-frontend workflow; explains the IPFS-vs-Bulletin hosting decision.
- `README.md` — product description. User-owned.
- `pay-per-view.md` — original brainstorm, kept for historical context.

## Upstream repos referenced (expected to be checked out locally by the developer)

- `polkadot-stack-template` — PBP-provided stack template (FRAME pallet, parachain runtime, React+PAPI frontend, CLI, deploy tooling).
- `triangle-js-sdks` — Polkadot Triangle JS SDKs (host API, product-sdk, statement-store, handoff-service, host-api-test-sdk).
- `host-api-example` — example app built on Triangle.
- `polkadot-product-brainstorm` — sibling brainstorm repo with broader Polkadot stack reference.

## Phased scope (descending priority)

- **Phase 1 — MVP.** FRAME pallet + payments + unencrypted Bulletin content + Triangle frontend + IPFS/DotNS deploy. Phase 1 paywall is UX-only, acknowledged.
- **Phase 2 — Content encryption.** Browser-held x25519 session keys; content-unlock-service OCW wraps content-lock-keys on purchase.
- **Phase 3 — Stablecoins via Asset Hub** (deferred; only if time after Phase 2).
- **Phase 4 — UX polish** (deferred; content renewal hooks, session-key recovery).

Phasing is a fallback strategy — if time runs short, Phase 1 is the must-ship baseline.

## Locked-in design decisions (see spec for detail)

- Frontend deploys to **IPFS + DotNS**, NOT Bulletin Chain (Bulletin's ~14-day expiry is incompatible with the demo window).
- Local dev runs on **Zombienet**, not the fast solo dev node — Triangle requires Statement Store, which only works on the relay-backed path in `stable2512-3`.
- **Trusted content-unlock-service** owns a master x25519 keypair (`SVC_PUB` / `SVC_PRIV`). `SVC_PUB` is genesis-published to chain storage; `SVC_PRIV` is a `chmod 600` file outside the Substrate keystore. A separate sr25519 service account (in the keystore) signs `grant_access` extrinsics. OCW-based implementation preferred; external daemon is the agreed fallback.
- Polkadot Triangle sandbox — **host API has no decrypt primitive**. All decryption is pure-JS browser-side using a browser-held x25519 private key.
- Fully pseudonymous identity (no People chain).
- Flat pricing set by creator. No platform fee. Each extrinsic caller pays their own tx fees.
- First-purchase UX via `pallet-utility::batch_all([register_encryption_key, purchase])`.

## Execution protocol

When executing a plan, these rules are non-negotiable:

- **Commit directly to `main` after each completed task.** No branches, no worktrees, no PRs. One commit per task, combining code + tests.
- **`docs/progress.md` is the canonical scoreboard.** Every plan's tasks are listed there. Flipping a `[ ]` to `[x]` is a separate, dedicated commit — never bundled with code.
- **Wait for explicit user validation before ticking.** After each task commit, surface a short validation prompt (e.g. "run `<cmd>`, confirm green, and I'll tick the box") and wait for a reply. Never flip `[x]` unilaterally.
- **Never commit under `docs/` without explicit per-commit approval.** This includes `progress.md`. Source commits are fine; doc commits always ask first.

If you're about to take an action during plan execution that doesn't match one of the rules above, stop and ask.

## Working conventions
- The canonical spec is `docs/design/spec.md`. When design decisions change, **edit the spec** — don't just note them in chat.
- Research docs are reference material; design decisions belong in the spec.
- When mentioning technology in the spec, stick to Polkadot-specific stack (FRAME, PAPI, Triangle, Bulletin, DotNS, OCW, Asset Hub, XCM, etc.). Non-Polkadot library choices (React, crypto libs, build tooling) are implementation-planning concerns and don't belong in the spec.
- The user commits the spec and other docs themselves — **don't commit without explicit approval**.
- `README.md` is user-owned; don't edit it unless asked.
- Style preference: concise, one topic at a time, refine before implementing. Prefer Polkadot-idiomatic solutions over generic ones when at a fork.
