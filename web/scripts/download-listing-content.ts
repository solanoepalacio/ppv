/**
 * Download the raw content bytes for a ppview listing.
 *
 * Given a listing_id (the on-chain key in ContentRegistry.Listings), this
 * resolves the content CID on-chain, then fetches the raw bytes from the
 * Paseo IPFS gateway. Useful for the demo — show that what's served to the
 * public is ciphertext, and only a buyer with the unwrapped session key can
 * decrypt it.
 *
 * Usage:
 *   npx tsx scripts/download-listing-content.ts <listing_id> [--out <path>]
 *   PARACHAIN_WS=ws://127.0.0.1:9944 npx tsx scripts/download-listing-content.ts 3
 */

import { writeFileSync } from "node:fs";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import { ppview } from "@polkadot-api/descriptors";
import { bulletinCidToString, bulletinCidToGatewayUrl } from "../src/utils/bulletinCid";

const PARACHAIN_WS = process.env.PARACHAIN_WS ?? "ws://127.0.0.1:9944";

function parseArgs(argv: string[]): { listingId: bigint; outPath: string } {
    const args = argv.slice(2);
    if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
        console.error(
            "Usage: npx tsx scripts/download-listing-content.ts <listing_id> [--out <path>]",
        );
        process.exit(1);
    }

    let listingIdStr: string | undefined;
    let outPath: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === "--out" || a === "-o") {
            outPath = args[++i];
        } else if (!listingIdStr) {
            listingIdStr = a;
        } else {
            console.error(`Unexpected argument: ${a}`);
            process.exit(1);
        }
    }

    if (!listingIdStr) {
        console.error("Missing <listing_id>");
        process.exit(1);
    }

    let listingId: bigint;
    try {
        listingId = BigInt(listingIdStr);
    } catch {
        console.error(`Invalid listing_id: ${listingIdStr}`);
        process.exit(1);
    }

    return {
        listingId,
        outPath: outPath ?? `listing-${listingId}-content.bin`,
    };
}

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function main() {
    const { listingId, outPath } = parseArgs(process.argv);

    console.log(`Connecting to ${PARACHAIN_WS} ...`);
    const client = createClient(withPolkadotSdkCompat(getWsProvider(PARACHAIN_WS)));
    const api = client.getTypedApi(ppview);

    try {
        console.log(`Querying ContentRegistry.Listings(${listingId}) ...`);
        const listing = await api.query.ContentRegistry.Listings.getValue(listingId);
        if (!listing) {
            console.error(`No listing with id ${listingId} on-chain.`);
            process.exit(1);
        }

        const codec = listing.content_cid.codec;
        const digestBytes = listing.content_cid.digest.asBytes();
        const cidStr = bulletinCidToString(codec, digestBytes);
        const url = bulletinCidToGatewayUrl(codec, digestBytes);

        console.log(`  title:      ${listing.title.asText()}`);
        console.log(`  creator:    ${listing.creator}`);
        console.log(`  content CID: ${cidStr}`);
        console.log(`  codec:      0x${codec.toString(16)}`);
        console.log(`  gateway:    ${url}`);

        console.log("\nFetching from IPFS gateway ...");
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`IPFS fetch failed: ${res.status} ${res.statusText}`);
        }
        const bytes = new Uint8Array(await res.arrayBuffer());

        writeFileSync(outPath, bytes);
        console.log(`\nDownloaded ${bytes.length} bytes → ${outPath}`);

        const previewLen = Math.min(64, bytes.length);
        console.log(`First ${previewLen} bytes (hex):`);
        console.log(`  ${toHex(bytes.slice(0, previewLen))}`);

        console.log(
            "\nIf this content was uploaded encrypted, the bytes above will look random —" +
                "\nhigh entropy, no plaintext magic bytes (e.g. no 0x00000020 'ftyp' for mp4).",
        );
    } finally {
        await client.destroy();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
