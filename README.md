# Pay Per View:

## 1. Concept

A decentralized pay-per-content platform (think "OnlyFans on blockchain") where creators publish content and buyers pay per piece. Built as a learning-focused PoC for PBP Lisbon 2026 — the primary goal is exercising a broad surface of the Polkadot stack, not shipping a viable product. Phased scope ensures there is always a demoable artifact even if the full stack isn't reached by the program deadline.

## 2. Why blockchain adds real value

This is the value-prop framing, not a claim that the PoC delivers every row.

| Pain point (OnlyFans today) | Blockchain solution |
|---|---|
| Consumer bank statements show "OnlyFans" — social stigma risk | Stablecoin payments show a tx hash, not a platform name |
| Consumer needs credit card = real identity tied to purchases | Pseudonymous wallet addresses, no KYC to buy |
| Platform nearly banned adult content in 2021 (payment-processor pressure) | No central authority can deplatform; content on IPFS is censorship-resistant |
| Creator can't export subscriber lists; banned = audience gone | Creator owns the on-chain data; audience relationships are verifiable |
| Messages not encrypted; staff can read DMs | Statement Store is P2P and ephemeral |
| Chargeback fraud — subscribers dispute charges after consuming | Crypto payments are final |
| Centralized database = data breach risk | No central database to breach |

## 3. Polkadot stack coverage

| Component | Polkadot feature |
|---|---|
| Content registry + payments pallet | FRAME (Polkadot SDK) |
| Chain-service automation | External daemon using subxt + FRAME event subscription |
| Chain-service authorization | Custom FRAME origin (`EnsureOrigin`) + `Pays::No` |
| Batched first-purchase UX | `pallet-utility::batch_all` |
| Frontend runtime | Polkadot Triangle host API + PAPI |
| Browser↔phone signing relay | Statement Store (via TruAPI) |
| Content storage | Bulletin Chain (IPFS-compatible) |
| Frontend hosting | IPFS + DotNS (Bulletin-hosted frontend as stretch) |
| Stablecoin payments | Asset Hub, `pallet-assets` (USDT 1984 / USDC 1337), XCM |

## 4. Implementation Limitations

- **Chain-service is a trusted custodian.** Whoever operates the chain-service daemon can decrypt every piece of content. In production this would be replaced with threshold encryption, TEEs, or proxy re-encryption — out of scope for a learning PoC.
- **Chain-service lacks an encryption key rotation mechanism (until hypothetic phase 5).** If the key is compromised it can't be rotated. If the node operator looses the key all encrypted content is lost forever.
- **Buyer-purchase mapping is publicly observable.** `WrappedKeys[(listing_id, buyer)]` is on a public chain; anyone can see which accounts bought which listings. Pseudonymity is still a real improvement over the Web2 credit-card model, but it's not strong privacy.
- **Session-key loss is a real failure mode.** Mitigated by `regrant_access`, at the cost of extra on-chain activity and chain-service work. Access recovery is planned for phase 4 (unlikely to be achieved during PBP).
- **Content expires on Bulletin Chain after ~14 days.**. Content renewal is planned to be implemented on phase 4 (unlikely to be achieved during PBP). Since on-chain data is not updated to reflect the expiration of the content the UI will break for expired content.
- **Limited Support for Media Types.** The application supports only uploading/rendering videos at the moment. The types of media supported were limited to reduce complexity on the front-end since managing complex media types on the front-end is not related to the main goal of the project (learning about polkadot). On a real application more media types could (and probably should) be supported.
