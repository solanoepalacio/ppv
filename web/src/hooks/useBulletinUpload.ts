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
import { getAliceSigner } from "./useAccount";
import { getUserSigner, getUserAddress } from "./signerManager";
import { bulletinCidToGatewayUrl } from "../utils/bulletinCid";
import type { BulletinCidFields } from "./useContentRegistry";

const BULLETIN_WS = "wss://paseo-bulletin-rpc.polkadot.io";

// Phase 1 PoC cap — chunked path is unstable on Paseo Bulletin, so keep every
// upload under the SDK's 2 MiB single-tx threshold.
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

// Quota issued by Alice when re-authorizing the user.
export const AUTH_TX_COUNT = 10;
export const AUTH_BYTES = 100n * 1024n * 1024n;

let _bulletinPapiClient: PolkadotClient | null = null;
let _aliceClient: AsyncBulletinClient | null = null;
let _userClient: { address: string; client: AsyncBulletinClient } | null = null;

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

function getUserClient(): AsyncBulletinClient {
	const address = getUserAddress();
	if (!address) {
		throw new Error('No user account selected — connect a wallet before uploading');
	}
	if (!_userClient || _userClient.address !== address) {
		_userClient = { address, client: buildClient(getUserSigner()) };
	}
	return _userClient.client;
}

// Test hooks — not part of the public API.
export function _resetUserClientForTests(): void { _userClient = null; }
export function getUserClientForTests(): AsyncBulletinClient { return getUserClient(); }

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
	aliceClient?: BulletinClientInterface;
	userClient?: BulletinClientInterface;
	userAddress?: string;
	getRemainingAuthorization?: (address: string) => Promise<RemainingAuthorization | null>;
}

async function ensureAuthorization(
	aliceClient: BulletinClientInterface,
	userAddress: string,
	uploadBytes: number,
	getQuota: (address: string) => Promise<RemainingAuthorization | null>,
): Promise<void> {
	const quota = await getQuota(userAddress);
	if (quota && quota.transactions >= 1 && quota.bytes >= BigInt(uploadBytes)) return;
	await aliceClient.authorizeAccount(userAddress, AUTH_TX_COUNT, AUTH_BYTES).send();
}

/**
 * Upload bytes to Bulletin Chain.
 *
 * Two-signer flow:
 *   1. Query on-chain authorization for the user account.
 *      If insufficient quota for this upload, Alice signs
 *      `authorize_account(userAddress, AUTH_TX_COUNT, AUTH_BYTES)`.
 *   2. The user signs `store()` for the content.
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

	const aliceClient = ctx?.aliceClient ?? getAliceClient();
	const userClient = ctx?.userClient ?? getUserClient();
	const userAddress = ctx?.userAddress ?? getUserAddress();
	const getQuota = ctx?.getRemainingAuthorization ?? getRemainingAuthorization;
	if (!userAddress) throw new Error("No connected user account for Bulletin upload");

	await ensureAuthorization(aliceClient, userAddress, bytes.length, getQuota);

	const progressCb: ProgressCallback = (event) => {
		if (event.type === ChunkStatus.ChunkCompleted) {
			onProgress?.(((event.index + 1) / event.total) * 100);
		}
	};

	const result = await userClient.store(bytes).withCallback(progressCb).send();

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
