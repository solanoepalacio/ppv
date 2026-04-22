import { createClient, Enum, type PolkadotClient, type PolkadotSigner } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import {
	AsyncBulletinClient,
	ChunkStatus,
	type BulletinClientInterface,
	type ProgressCallback,
} from "@parity/bulletin-sdk";
import { bulletin } from "@polkadot-api/descriptors";
import { getAliceSigner, getAliceAddress } from "./useAccount";
import { bulletinCidToGatewayUrl } from "../utils/bulletinCid";
import type { BulletinCidFields } from "./useContentRegistry";

const BULLETIN_WS = "wss://paseo-bulletin-rpc.polkadot.io";

// Phase 1 PoC cap — chunked path is unstable on Paseo Bulletin, so keep every
// upload under the SDK's 2 MiB single-tx threshold.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export const AUTH_TX_COUNT = 10;
export const AUTH_BYTES = 100n * 1024n * 1024n;

let _bulletinPapiClient: PolkadotClient | null = null;
let _aliceClient: AsyncBulletinClient | null = null;

function getPapiClient(): PolkadotClient {
	if (!_bulletinPapiClient) {
		_bulletinPapiClient = createClient(withPolkadotSdkCompat(getWsProvider(BULLETIN_WS)));
	}
	return _bulletinPapiClient;
}

function buildClient(signer: PolkadotSigner): AsyncBulletinClient {
	const papi = getPapiClient();
	const api = papi.getTypedApi(bulletin);
	return new AsyncBulletinClient(api, signer, (papi as any).submit);
}

function getAliceClient(): AsyncBulletinClient {
	if (!_aliceClient) _aliceClient = buildClient(getAliceSigner());
	return _aliceClient;
}

export interface RemainingAuthorization {
	transactions: number;
	bytes: bigint;
}

/**
 * Query Bulletin's authorization storage for the given account.
 * Returns null when the account has no authorization record.
 *
 * The descriptor's `Authorizations` map is keyed by a `scope` enum
 * (`Account(SS58) | Preimage(hash32)`) and stores
 * `{ extent: { transactions, bytes }, expiration }`. We only need the extent.
 */
export async function getRemainingAuthorization(
	address: string,
): Promise<RemainingAuthorization | null> {
	const api = getPapiClient().getTypedApi(bulletin);
	const entry = await api.query.TransactionStorage.Authorizations.getValue(
		Enum("Account", address),
	);
	if (!entry) return null;
	return { transactions: entry.extent.transactions, bytes: entry.extent.bytes };
}

export interface UploadContext {
	client?: BulletinClientInterface;
	address?: string;
	getRemainingAuthorization?: (address: string) => Promise<RemainingAuthorization | null>;
}

async function ensureAuthorization(
	client: BulletinClientInterface,
	address: string,
	uploadBytes: number,
	getQuota: (address: string) => Promise<RemainingAuthorization | null>,
): Promise<void> {
	const quota = await getQuota(address);
	if (quota && quota.transactions >= 1 && quota.bytes >= BigInt(uploadBytes)) return;
	await client.authorizeAccount(address, AUTH_TX_COUNT, AUTH_BYTES).send();
}

/**
 * Upload bytes to Bulletin Chain.
 *
 * Single-signer flow: Alice signs both `authorize_account` and `store`.
 * Bulletin is content-storage infrastructure; the user identity on-chain
 * lives on the parachain (`publish_content`), not Bulletin. Signing
 * Bulletin extrinsics with the user's extension wallet (Talisman) against
 * a non-mainstream chain triggers BadProof via the PJS `withSignedTransaction`
 * path, so we route Bulletin through the dev-chain Alice key.
 *
 * Idempotency comes from the on-chain check — there is no in-memory cache,
 * so browser refreshes, multiple tabs, and new sessions all behave correctly
 * without bookkeeping.
 */
export async function uploadToBulletin(
	bytes: Uint8Array,
	onProgress?: (pct: number) => void,
	ctx?: UploadContext,
): Promise<BulletinCidFields> {
	if (bytes.length > MAX_UPLOAD_BYTES) {
		throw new Error(
			`File is too large: ${bytes.length} bytes. Phase 1 PoC supports up to 2 MiB per upload.`,
		);
	}

	const client = ctx?.client ?? getAliceClient();
	const address = ctx?.address ?? getAliceAddress();
	const getQuota = ctx?.getRemainingAuthorization ?? getRemainingAuthorization;

	await ensureAuthorization(client, address, bytes.length, getQuota);

	const progressCb: ProgressCallback = (event) => {
		if (event.type === ChunkStatus.ChunkCompleted) {
			onProgress?.(((event.index + 1) / event.total) * 100);
		}
	};

	const result = await client.store(bytes).withCallback(progressCb).send();

	onProgress?.(100);

	if (!result.cid) throw new Error("Bulletin upload returned no CID");

	return {
		codec: result.cid.code,
		digestBytes: new Uint8Array(result.cid.multihash.digest),
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
