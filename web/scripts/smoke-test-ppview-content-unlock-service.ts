import { createClient, FixedSizeBinary, Binary, type SS58String } from "polkadot-api";
import { fromBufferToBase58 } from "@polkadot-api/substrate-bindings";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import { DEV_PHRASE, entropyToMiniSecret, mnemonicToEntropy } from "@polkadot-labs/hdkd-helpers";
import { ppview } from "@polkadot-api/descriptors";
import { createRequire } from "node:module";
import type _SodiumNs from "libsodium-wrappers";

// libsodium-wrappers@0.7.x ships a broken ESM entry (its .mjs re-imports a
// sibling .mjs that isn't in the package files). Load the working CJS entry
// via createRequire; this works in a `"type": "module"` project because
// createRequire is explicitly designed for CJS interop.
const require = createRequire(import.meta.url);
const _sodium: typeof _SodiumNs = require("libsodium-wrappers");

// P2b smoke test: exercises the content-unlock-service daemon end-to-end.
//
// Preconditions:
//   1. Zombienet is up (scripts/start-local.sh) with the P2a-patched parachain,
//      reachable at PARACHAIN_WS (default ws://127.0.0.1:9944).
//   2. The content-unlock-service daemon is running in a separate terminal
//      (scripts/start-content-unlock-service.sh), signed by the sr25519 key
//      baked into the genesis preset as ServiceAccountId, and loaded with the
//      SVC_PRIV whose derived pubkey matches on-chain ServicePublicKey.
//
// Flow:
//   [1] Sanity: ServicePublicKey non-zero.
//   [2] Alice + Bob each register real x25519 pubkeys.
//   [3] Random 32-byte content-lock-key (CLK); seal it to SVC_PUB via NaCl
//       crypto_box_seal → 80-byte on-chain locked_content_lock_key.
//   [4] Reserve listing_id from NextListingId and kick off the WrappedKeys
//       poll in the background before any write — grants are effectively
//       serialized by finalization, so starting the poll early avoids
//       race-losing the Creator grant and keeps the test's timeout budget
//       aligned with chain wall-clock rather than script wall-clock.
//   [5] Alice create_listing + Bob purchase(listing_id); await the
//       background poll. The daemon observes ListingCreated +
//       PurchaseCompleted, unseals with SVC_PRIV, and re-seals per target.
//   [6] Open both WrappedKeys with the corresponding x25519 priv keys; assert
//       each yields the original CLK byte-for-byte. This proves the full
//       seal → daemon → re-seal → open round-trip works against a live chain.

const PARACHAIN_WS = process.env.PARACHAIN_WS ?? "ws://127.0.0.1:9944";
// Each grant_access round-trips ~12s on Zombienet (one finalization), and
// the daemon serializes Creator/Buyer grants through a single event stream.
// Budget for both, plus the block time between ListingCreated and
// PurchaseCompleted, plus headroom.
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 180_000);
const POLL_INTERVAL_MS = 1_000;
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

function hexBytes(bytes: Uint8Array): string {
	return (
		"0x" +
		Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("")
	);
}

async function sleep(ms: number) {
	return new Promise((res) => setTimeout(res, ms));
}

async function main() {
	console.log("Waiting for libsodium...");
	await _sodium.ready;
	const sodium = _sodium;

	console.log("Connecting to", PARACHAIN_WS, "...");
	const client = createClient(withPolkadotSdkCompat(getWsProvider(PARACHAIN_WS)));
	const api = client.getTypedApi(ppview);
	console.log("Connected.");

	const alice = devSigner("//Alice");
	const aliceSS58 = devSs58("//Alice");
	const bob = devSigner("//Bob");
	const bobSS58 = devSs58("//Bob");

	// --- [1/5] genesis sanity ---
	console.log("\n[1/5] Reading ServicePublicKey from chain...");
	const svcPub = await api.query.ContentRegistry.ServicePublicKey.getValue();
	const svcPubHex = svcPub.asHex();
	if (svcPubHex === ZERO_PUB_HEX) {
		throw new Error("ServicePublicKey is zero — genesis preset did not populate it");
	}
	const svcPubBytes = svcPub.asBytes();
	console.log("ServicePublicKey:", svcPubHex);

	// --- [2/5] register x25519 keys for Alice and Bob ---
	console.log("\n[2/5] Alice and Bob register x25519 encryption keys...");
	const aliceBox = sodium.crypto_box_keypair();
	const bobBox = sodium.crypto_box_keypair();
	console.log("  alice x25519 pub:", hexBytes(aliceBox.publicKey));
	console.log("  bob   x25519 pub:", hexBytes(bobBox.publicKey));

	const aliceReg = await api.tx.ContentRegistry.register_encryption_key({
		pubkey: FixedSizeBinary.fromBytes(aliceBox.publicKey),
	}).signAndSubmit(alice);
	if (!aliceReg.ok) {
		throw new Error(`alice register_encryption_key failed: ${JSON.stringify(aliceReg)}`);
	}
	const bobReg = await api.tx.ContentRegistry.register_encryption_key({
		pubkey: FixedSizeBinary.fromBytes(bobBox.publicKey),
	}).signAndSubmit(bob);
	if (!bobReg.ok) {
		throw new Error(`bob register_encryption_key failed: ${JSON.stringify(bobReg)}`);
	}

	const aliceOnChain = await api.query.ContentRegistry.EncryptionKeys.getValue(aliceSS58);
	const bobOnChain = await api.query.ContentRegistry.EncryptionKeys.getValue(bobSS58);
	if (!aliceOnChain || aliceOnChain.asHex() !== hexBytes(aliceBox.publicKey)) {
		throw new Error(`EncryptionKeys[Alice] mismatch: got ${aliceOnChain?.asHex()}`);
	}
	if (!bobOnChain || bobOnChain.asHex() !== hexBytes(bobBox.publicKey)) {
		throw new Error(`EncryptionKeys[Bob] mismatch: got ${bobOnChain?.asHex()}`);
	}
	console.log("  EncryptionKeys[Alice] ✓");
	console.log("  EncryptionKeys[Bob]   ✓");

	// --- [3/5] seal a random CLK to SVC_PUB ---
	console.log("\n[3/5] Sealing random 32-byte content-lock-key to SVC_PUB...");
	const clk = sodium.randombytes_buf(32);
	const sealedForSvc = sodium.crypto_box_seal(clk, svcPubBytes);
	if (sealedForSvc.length !== 80) {
		throw new Error(`sealed-box length ${sealedForSvc.length} (expected 80)`);
	}
	console.log("  clk        :", hexBytes(clk));
	console.log("  sealed(80B):", hexBytes(sealedForSvc));

	// --- [4/5] reserve listing_id + start polling in background ---
	// We know NextListingId deterministically reserves the ID for our create,
	// and there's no competing creator in the smoke. Kicking the poll off
	// before the write means the test clock already covers the daemon's
	// full observe→grant pipeline (~2 × 12s finalization + the gap between
	// ListingCreated and PurchaseCompleted blocks).
	const listingId = await api.query.ContentRegistry.NextListingId.getValue();
	console.log(
		`\n[4/5] Reserved listing_id=${listingId}; starting background WrappedKeys poll (timeout ${POLL_TIMEOUT_MS}ms)...`,
	);
	const started = Date.now();
	let aliceWrapped: FixedSizeBinary<80> | undefined;
	let bobWrapped: FixedSizeBinary<80> | undefined;
	const pollPromise = (async () => {
		while (Date.now() - started < POLL_TIMEOUT_MS) {
			if (!aliceWrapped) {
				aliceWrapped = await api.query.ContentRegistry.WrappedKeys.getValue(
					aliceSS58,
					listingId,
				);
				if (aliceWrapped) {
					const elapsed = ((Date.now() - started) / 1000).toFixed(1);
					console.log(`  [+${elapsed}s] WrappedKeys[(Alice, _)] present ✓`);
				}
			}
			if (!bobWrapped) {
				bobWrapped = await api.query.ContentRegistry.WrappedKeys.getValue(
					bobSS58,
					listingId,
				);
				if (bobWrapped) {
					const elapsed = ((Date.now() - started) / 1000).toFixed(1);
					console.log(`  [+${elapsed}s] WrappedKeys[(Bob,   _)] present ✓`);
				}
			}
			if (aliceWrapped && bobWrapped) return;
			await sleep(POLL_INTERVAL_MS);
		}
	})();

	// --- [5/5] Alice creates listing, Bob purchases, then await the poll ---
	console.log("\n[5/5] Alice creates listing, Bob purchases...");
	const digest = new Uint8Array(32).fill(0xab);
	const thumbDigest = new Uint8Array(32).fill(0xcd);
	const contentHash = new Uint8Array(32).fill(0x44);
	const createTx = api.tx.ContentRegistry.create_listing({
		content_cid: { codec: 0x55, digest: FixedSizeBinary.fromBytes(digest) },
		thumbnail_cid: { codec: 0x55, digest: FixedSizeBinary.fromBytes(thumbDigest) },
		content_hash: FixedSizeBinary.fromBytes(contentHash),
		title: Binary.fromText("p2b-smoke"),
		description: Binary.fromText("created by P2b smoke script"),
		price: 500_000_000_000n,
		locked_content_lock_key: FixedSizeBinary.fromBytes(sealedForSvc),
	});
	const createResult = await createTx.signAndSubmit(alice);
	if (!createResult.ok) {
		throw new Error(`create_listing failed: ${JSON.stringify(createResult)}`);
	}
	const assignedId = (await api.query.ContentRegistry.NextListingId.getValue()) - 1n;
	if (assignedId !== listingId) {
		throw new Error(`race: reserved listing_id=${listingId} but chain assigned ${assignedId}`);
	}
	console.log("  create_listing finalized at", createResult.block.hash);

	const purchaseResult = await api.tx.ContentRegistry.purchase({
		listing_id: listingId,
	}).signAndSubmit(bob);
	if (!purchaseResult.ok) {
		throw new Error(`purchase failed: ${JSON.stringify(purchaseResult)}`);
	}
	console.log("  purchase finalized at", purchaseResult.block.hash);

	await pollPromise;
	if (!aliceWrapped) {
		throw new Error(
			`WrappedKeys[(Alice, ${listingId})] never appeared within ${POLL_TIMEOUT_MS}ms. ` +
				`Check the daemon logs — is it running? connected to the right RPC?`,
		);
	}
	if (!bobWrapped) {
		throw new Error(
			`WrappedKeys[(Bob, ${listingId})] never appeared within ${POLL_TIMEOUT_MS}ms.`,
		);
	}

	// Opening each wrapped key with the corresponding x25519 priv should
	// reproduce the original CLK. This is the tightest correctness assertion
	// we can make from the outside.
	const openedAlice = sodium.crypto_box_seal_open(
		aliceWrapped.asBytes(),
		aliceBox.publicKey,
		aliceBox.privateKey,
	);
	const openedBob = sodium.crypto_box_seal_open(
		bobWrapped.asBytes(),
		bobBox.publicKey,
		bobBox.privateKey,
	);
	if (hexBytes(openedAlice) !== hexBytes(clk)) {
		throw new Error(
			`Alice's WrappedKeys unsealed to ${hexBytes(openedAlice)}; expected ${hexBytes(clk)}`,
		);
	}
	if (hexBytes(openedBob) !== hexBytes(clk)) {
		throw new Error(
			`Bob's WrappedKeys unsealed to ${hexBytes(openedBob)}; expected ${hexBytes(clk)}`,
		);
	}
	console.log("  Alice unseals WrappedKeys → original CLK ✓");
	console.log("  Bob   unseals WrappedKeys → original CLK ✓");

	await client.destroy();
	console.log("\nDone.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
