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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// P2a smoke test: exercises the encryption-model surface of pallet-content-registry
// against a running Zombienet parachain. The chain's on-chain ServiceAccountId
// is baked into `blockchain/runtime/src/genesis_config_presets.rs` from
// `keys/svc_signer.suri`; this script reads the same SURI file to sign
// grant_access with a keypair that matches the on-chain account.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const PARACHAIN_WS = process.env.PARACHAIN_WS ?? "ws://127.0.0.1:9944";
const SERVICE_SIGNER_PATH = process.env.PPVIEW_SERVICE_SIGNER
    ?? resolve(REPO_ROOT, "keys/svc_signer.suri");
const ZERO_PUB_HEX = "0x" + "00".repeat(32);

function hexToBytes(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) throw new Error(`invalid hex length: ${hex.length}`);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/// Mirrors subxt-signer's `SecretUri::from_str` / `Keypair::from_uri`:
/// - `0x<64 hex>` → those 32 bytes ARE the mini-secret seed (with optional `//path`).
/// - `//path` / `/path` → DEV_PHRASE entropy as the mini-secret, plus junctions.
/// - BIP-39 mnemonic is not supported here; add if/when needed.
function keypairFromSuri(suri: string) {
    const trimmed = suri.trim();
    if (!trimmed) throw new Error("empty SURI");

    const splitIdx = trimmed.indexOf("/");
    const phrase = splitIdx === -1 ? trimmed : trimmed.slice(0, splitIdx);
    const path = splitIdx === -1 ? "" : trimmed.slice(splitIdx);

    let miniSecret: Uint8Array;
    if (phrase.startsWith("0x")) {
        const hex = phrase.slice(2);
        if (hex.length !== 64) {
            throw new Error(`hex SURI must be 32 bytes (got ${hex.length / 2})`);
        }
        miniSecret = hexToBytes(hex);
    } else if (phrase === "") {
        // leading `//Alice` etc — default to DEV_PHRASE entropy.
        miniSecret = entropyToMiniSecret(mnemonicToEntropy(DEV_PHRASE));
    } else {
        throw new Error(
            `unsupported SURI phrase: expected 0x-prefixed hex or DEV_PHRASE derivation, got '${phrase.slice(0, 16)}...'`,
        );
    }

    return sr25519CreateDerive(miniSecret)(path);
}

function signerFromSuri(suri: string) {
    const keypair = keypairFromSuri(suri);
    return {
        signer: getPolkadotSigner(keypair.publicKey, "Sr25519", keypair.sign),
        publicKey: keypair.publicKey,
        ss58: fromBufferToBase58(42)(keypair.publicKey) as SS58String,
    };
}

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
    const bobSS58 = devSs58("//Bob");

    console.log(`Loading service signer from ${SERVICE_SIGNER_PATH} ...`);
    const suri = readFileSync(SERVICE_SIGNER_PATH, "utf8");
    const service = signerFromSuri(suri);
    console.log("Service AccountId (local, SS58):", service.ss58);

    // --- genesis sanity ---
    console.log("\n[1/5] Reading ServicePublicKey + ServiceAccountId...");
    const svcPub = await api.query.ContentRegistry.ServicePublicKey.getValue();
    const svcAcc = await api.query.ContentRegistry.ServiceAccountId.getValue();
    const svcPubHex = svcPub.asHex();
    if (svcPubHex === ZERO_PUB_HEX) {
        throw new Error("ServicePublicKey is zero — genesis preset did not populate it");
    }
    if (svcAcc !== service.ss58) {
        throw new Error(
            `ServiceAccountId on chain is ${svcAcc}; local signer at ${SERVICE_SIGNER_PATH} derives ${service.ss58}. Regenerate the genesis preset via 'cargo run -p ppview-chain-service -- print-service-account'.`,
        );
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

    // --- grant_access signed by the configured service signer ---
    console.log("\n[5/5] Service signer grants access to Bob...");
    const grantTx = api.tx.ContentRegistry.grant_access({
        listing_id: listingId,
        buyer: bobSS58,
        wrapped_key: FixedSizeBinary.fromBytes(wrapped),
    });
    const grantResult = await grantTx.signAndSubmit(service.signer);
    if (!grantResult.ok) {
        throw new Error(`grant_access (service signer) failed: ${JSON.stringify(grantResult)}`);
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
