import { createClient, FixedSizeBinary, Binary, type SS58String } from "polkadot-api";
import { fromBufferToBase58 } from "@polkadot-api/substrate-bindings";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    DEV_PHRASE,
    entropyToMiniSecret,
    mnemonicToEntropy,
} from "@polkadot-labs/hdkd-helpers";
import { ppview } from "@polkadot-api/descriptors";

const PARACHAIN_WS = process.env.PARACHAIN_WS ?? "ws://127.0.0.1:9944";

function devKeypair(path: string) {
    const entropy = mnemonicToEntropy(DEV_PHRASE);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    return derive(path);
}

function devSigner(path: string) {
    const keypair = devKeypair(path);
    return getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign);
}

async function main() {
    console.log("Connecting to", PARACHAIN_WS, "...");
    const client = createClient(withPolkadotSdkCompat(getWsProvider(PARACHAIN_WS)));
    const api = client.getTypedApi(ppview);
    console.log("Connected.");

    const alice = devSigner("//Alice");
    const bob = devSigner("//Bob");
    const bobSS58 = fromBufferToBase58(42)(devKeypair("//Bob").publicKey) as SS58String;

    const digest = new Uint8Array(32).fill(0xaa);
    const thumbDigest = new Uint8Array(32).fill(0xcc);
    const contentHash = new Uint8Array(32).fill(0x33);

    // --- create_listing ---
    console.log("\n[1/3] Submitting create_listing as Alice...");
    const createTx = api.tx.ContentRegistry.create_listing({
        content_cid: { codec: 0x55, digest: FixedSizeBinary.fromBytes(digest) },
        thumbnail_cid: { codec: 0x55, digest: FixedSizeBinary.fromBytes(thumbDigest) },
        content_hash: FixedSizeBinary.fromBytes(contentHash),
        title: Binary.fromText("smoke"),
        description: Binary.fromText("created by smoke script"),
        price: 500_000_000_000n,
        locked_content_lock_key: FixedSizeBinary.fromBytes(new Uint8Array(80)),
    });

    const createResult = await createTx.signAndSubmit(alice);
    if (!createResult.ok) {
        throw new Error(`create_listing failed: ${JSON.stringify(createResult)}`);
    }
    console.log("create_listing included at", createResult.block.hash);

    const nextId = await api.query.ContentRegistry.NextListingId.getValue();
    const listingId = nextId - 1n;
    console.log("created listing_id:", listingId);

    // --- purchase ---
    console.log("\n[2/3] Submitting purchase as Bob...");
    const purchaseTx = api.tx.ContentRegistry.purchase({ listing_id: listingId });
    const purchaseResult = await purchaseTx.signAndSubmit(bob);
    if (!purchaseResult.ok) {
        throw new Error(`purchase failed: ${JSON.stringify(purchaseResult)}`);
    }
    console.log("purchase included at", purchaseResult.block.hash);

    // --- verify purchase record ---
    console.log("\n[3/3] Reading Purchases storage for Bob...");
    const record = await api.query.ContentRegistry.Purchases.getValue(bobSS58, listingId);
    console.log("purchase record (block number):", record);

    await client.destroy();
    console.log("\nDone.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
