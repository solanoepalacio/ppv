# Pay-Per-View: Decentralized Content Monetization

## Concept

A decentralized pay-per-content platform (think "OnlyFans on blockchain") where creators publish content and consumers pay per piece — with privacy for both sides.

## Why Blockchain Adds Real Value

| Pain point (OnlyFans today) | Blockchain solution |
|---|---|
| Consumer bank statements show "OnlyFans" — social stigma risk | Stablecoin payments show a tx hash, not a platform name |
| Consumer needs credit card = real identity tied to purchases | Pseudonymous wallet addresses, no KYC to buy |
| Platform nearly banned adult content in 2021 (payment processor pressure) | No central authority can deplatform; content on IPFS is censorship-resistant |
| Creator can't export subscriber lists; banned = audience gone | Creator owns the on-chain data; audience relationships are verifiable |
| Messages not encrypted; staff can read DMs | Statement Store is P2P and ephemeral |
| Chargeback fraud — subscribers dispute charges after consuming | Crypto payments are final |
| Centralized database = data breach risk | No central database to breach |

## Architecture

1. **Creator** uploads content to Bulletin Chain / IPFS
2. **Creator** lists content on-chain (pallet) with: price, content CID, preview
3. **Consumer** pays on-chain
4. **Pallet** records payment and grants access
5. **Frontend** checks on-chain access before rendering content

## Phased Scope

### Phase 1: Core flow (MVP)
- Custom FRAME pallet: content registry (CID, price, creator), payment tracking (who paid for what)
- Payments in native DOT
- Content stored on Bulletin Chain (unencrypted — access control is UX-level, not cryptographic)
- React frontend with PAPI: browse content, pay, view purchased content
- Deploy via Bulletin Chain + DotNS

### Phase 2: Content encryption
- Creator encrypts content with a symmetric key before uploading
- On payment, pallet stores the decryption key encrypted to the consumer's public key
- Frontend decrypts locally after purchase
- This makes access control cryptographic, not just UX-level

### Phase 3: Stablecoin payments via Asset Hub
- Accept USDC (asset ID 1337) / USDT (asset ID 1984) on Asset Hub
- XCM integration for cross-chain payment verification
- Consumers no longer need to hold DOT

## Stack Coverage

| Component | Polkadot feature |
|---|---|
| Backend (pallet) | FRAME, Polkadot SDK |
| Content storage | Bulletin Chain |
| Frontend hosting | Bulletin Chain + DotNS |
| Frontend framework | React + PAPI |
| Messaging (stretch) | Statement Store |
| Payments (phase 3) | Asset Hub, pallet-assets, XCM |

## Key Design Decisions (TBD)

- Content size limits on Bulletin Chain (14-day expiry with renewal)
- Preview mechanism (free thumbnail/excerpt vs. blurred content)
- Creator identity: fully pseudonymous or optional People chain integration?
- Fee structure: flat per-content price set by creator? Platform fee?

## Research Notes

- x402 protocol was considered but is incompatible: requires server-side logic (HTTP 402 + facilitator service), can't run on static IPFS/Bulletin Chain sites. Also no official Polkadot support.
- Stablecoins on Polkadot: USDT (asset ID 1984) and USDC (1337) are natively issued on Asset Hub as "sufficient" assets.
- OnlyFans takes 20% cut; this platform would have no intermediary fee (only chain transaction costs).
