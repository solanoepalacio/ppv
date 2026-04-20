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

// P2a smoke test: exercises the encryption-model surface of pallet-content-registry
// against a running Zombienet parachain. Assumes the genesis preset wires
// ServiceAccountId to //Dave (per blockchain/runtime/src/genesis_config_presets.rs).

const PARACHAIN_WS = process.env.PARACHAIN_WS ?? "ws://127.0.0.1:9944";
const ZERO_PUB_HEX = "0x" + "00".repeat(32);

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

function devSs58(path: string): SS58String {
    return fromBufferToBase58(42)(devKeypair(path).publicKey) as SS58String;
}

async function main() {
    console.log("Connecting to", PARACHAIN_WS, "...");
    const client = createClient(withPolkadotSdkCompat(getWsProvider(PARACHAIN_WS)));
    const api = client.getTypedApi(ppview);
    console.log("Connected.");

    const alice = devSigner("//Alice");
    const bob = devSigner("//Bob");
    const dave = devSigner("//Dave");
    const bobSS58 = devSs58("//Bob");
    const daveSS58 = devSs58("//Dave");

    // --- genesis sanity ---
    console.log("\n[1/5] Reading ServicePublicKey + ServiceAccountId...");
    const svcPub = await api.query.ContentRegistry.ServicePublicKey.getValue();
    const svcAcc = await api.query.ContentRegistry.ServiceAccountId.getValue();
    const svcPubHex = svcPub.asHex();
    if (svcPubHex === ZERO_PUB_HEX) {
        throw new Error("ServicePublicKey is zero — genesis preset did not populate it");
    }
    if (svcAcc !== daveSS58) {
        throw new Error(`ServiceAccountId is ${svcAcc}, expected ${daveSS58} (//Dave)`);
    }
    console.log("ServicePublicKey:", svcPubHex);
    console.log("ServiceAccountId:", svcAcc);

    // --- register_encryption_key as Bob ---
    console.log("\n[2/5] Bob registers an x25519 pubkey...");
    const bobPubkey = new Uint8Array(32).fill(0x11);
    const regTx = api.tx.ContentRegistry.register_encryption_key({
        pubkey: FixedSizeBinary.fromBytes(bobPubkey),
    });
    const regResult = await regTx.signAndSubmit(bob);
    if (!regResult.ok) {
        throw new Error(`register_encryption_key failed: ${JSON.stringify(regResult)}`);
    }
    const storedBobKey = await api.query.ContentRegistry.EncryptionKeys.getValue(bobSS58);
    if (!storedBobKey) throw new Error("EncryptionKeys[Bob] missing after registration");
    if (storedBobKey.asHex() !== "0x" + "11".repeat(32)) {
        throw new Error(`EncryptionKeys[Bob] mismatch: got ${storedBobKey.asHex()}`);
    }
    console.log("EncryptionKeys[Bob] ✓");

    // --- seed a listing to grant access against ---
    console.log("\n[3/5] Alice creates a listing...");
    const digest = new Uint8Array(32).fill(0xaa);
    const thumbDigest = new Uint8Array(32).fill(0xcc);
    const contentHash = new Uint8Array(32).fill(0x33);
    const lockedKey = new Uint8Array(80).fill(0x7a);
    const createTx = api.tx.ContentRegistry.create_listing({
        content_cid: { codec: 0x55, digest: FixedSizeBinary.fromBytes(digest) },
        thumbnail_cid: { codec: 0x55, digest: FixedSizeBinary.fromBytes(thumbDigest) },
        content_hash: FixedSizeBinary.fromBytes(contentHash),
        title: Binary.fromText("p2a-smoke"),
        description: Binary.fromText("created by P2a smoke script"),
        price: 500_000_000_000n,
        locked_content_lock_key: FixedSizeBinary.fromBytes(lockedKey),
    });
    const createResult = await createTx.signAndSubmit(alice);
    if (!createResult.ok) {
        throw new Error(`create_listing failed: ${JSON.stringify(createResult)}`);
    }
    const listingId = (await api.query.ContentRegistry.NextListingId.getValue()) - 1n;
    console.log("listing_id:", listingId);

    // --- grant_access must reject non-service origin ---
    console.log("\n[4/5] Non-service caller (Bob) should be rejected by grant_access...");
    const wrapped = new Uint8Array(80).fill(0x77);
    const rogueTx = api.tx.ContentRegistry.grant_access({
        listing_id: listingId,
        buyer: bobSS58,
        wrapped_key: FixedSizeBinary.fromBytes(wrapped),
    });
    const rogueResult = await rogueTx.signAndSubmit(bob);
    if (rogueResult.ok) {
        throw new Error("grant_access unexpectedly succeeded when called by Bob (non-service)");
    }
    console.log("Bob's grant_access correctly rejected.");

    // --- grant_access as service account (//Dave) ---
    console.log("\n[5/5] Dave (service account) grants access to Bob...");
    const grantTx = api.tx.ContentRegistry.grant_access({
        listing_id: listingId,
        buyer: bobSS58,
        wrapped_key: FixedSizeBinary.fromBytes(wrapped),
    });
    const grantResult = await grantTx.signAndSubmit(dave);
    if (!grantResult.ok) {
        throw new Error(`grant_access (Dave) failed: ${JSON.stringify(grantResult)}`);
    }
    const stored = await api.query.ContentRegistry.WrappedKeys.getValue(bobSS58, listingId);
    if (!stored) throw new Error("WrappedKeys[Bob, listing_id] missing after grant_access");
    if (stored.asHex() !== "0x" + "77".repeat(80)) {
        throw new Error(`WrappedKeys mismatch: got ${stored.asHex()}`);
    }
    console.log("WrappedKeys[Bob, listing_id] ✓");

    await client.destroy();
    console.log("\nDone.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
