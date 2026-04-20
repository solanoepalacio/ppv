import { createClient, type PolkadotClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import {
	AsyncBulletinClient,
	ChunkStatus,
	type BulletinClientInterface,
	type ProgressCallback,
} from "@parity/bulletin-sdk";
import { bulletin } from "@polkadot-api/descriptors";
import { devAccounts } from "./useAccount";
import { bulletinCidToGatewayUrl } from "../utils/bulletinCid";
import type { BulletinCidFields } from "./useContentRegistry";

const BULLETIN_WS = "wss://paseo-bulletin-rpc.polkadot.io";

// Cap uploads at the SDK's default `chunkingThreshold` (2 MiB) so every
// request uses the single-tx signed path. Chunked uploads trigger a renderer
// SIGILL on Paseo — per-chunk Blake2b hashing and DAG-PB manifest building
// through `@polkadot/wasm-crypto` panics under load. Phase 1 PoC only.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

let _bulletinPapiClient: PolkadotClient | null = null;
let _asyncClient: AsyncBulletinClient | null = null;

function getDefaultBulletinClient(): AsyncBulletinClient {
	if (!_bulletinPapiClient) {
		_bulletinPapiClient = createClient(withPolkadotSdkCompat(getWsProvider(BULLETIN_WS)));
	}
	if (!_asyncClient) {
		const api = _bulletinPapiClient.getTypedApi(bulletin);
		const aliceSigner = devAccounts[0].signer;
		_asyncClient = new AsyncBulletinClient(
			api,
			aliceSigner,
			(_bulletinPapiClient as any).submit,
		);
	}
	return _asyncClient;
}

/**
 * Upload bytes to Bulletin Chain, returning the CID fields needed for the pallet.
 *
 * Uses the signed store path unconditionally — Alice signs every tx and pays
 * Bulletin fees. The SDK auto-chunks above its 2 MiB `chunkingThreshold`.
 *
 * We deliberately avoid the preimage-authorized unsigned path here: it needs
 * two round-trips (signed `authorize_preimage` + bare unsigned `store`), and
 * PAPI's bare `submit` has no SDK-level timeout. When Paseo Bulletin silently
 * drops or delays finalization of the bare tx, the UI hangs indefinitely.
 * The signed path surfaces failures via `signSubmitAndWatch` (120s timeout).
 *
 * Pass an injectable `_client` for testing (accepts MockBulletinClient).
 */
export async function uploadToBulletin(
	bytes: Uint8Array,
	onProgress?: (pct: number) => void,
	_client?: BulletinClientInterface,
): Promise<BulletinCidFields> {
	if (bytes.length > MAX_UPLOAD_BYTES) {
		throw new Error(
			`File is too large: ${bytes.length} bytes. Phase 1 PoC supports up to 2 MiB per upload.`,
		);
	}

	const client = _client ?? getDefaultBulletinClient();

	const progressCb: ProgressCallback = (event) => {
		if (event.type === ChunkStatus.ChunkCompleted) {
			onProgress?.(((event.index + 1) / event.total) * 100);
		}
	};

	const result = await client.store(bytes).withCallback(progressCb).send();

	onProgress?.(100);

	if (!result.cid) throw new Error("Bulletin upload returned no CID");

	const cid = result.cid;
	return {
		codec: cid.code,
		digestBytes: new Uint8Array(cid.multihash.digest),
	};
}

/**
 * Fetch raw bytes from the Paseo IPFS gateway.
 * Throws on HTTP error or network failure.
 */
export async function fetchFromIpfs(cid: BulletinCidFields): Promise<Uint8Array> {
	const url = bulletinCidToGatewayUrl(cid.codec, cid.digestBytes);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status} ${res.statusText}`);
	return new Uint8Array(await res.arrayBuffer());
}
