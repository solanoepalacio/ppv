import { createClient, type PolkadotClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import {
  AsyncBulletinClient,
  ChunkStatus,
  HashAlgorithm,
  getContentHash,
  type BulletinClientInterface,
  type ProgressCallback,
} from '@parity/bulletin-sdk';
import { bulletin } from '@polkadot-api/descriptors';
import { devAccounts } from './useAccount';
import { bulletinCidToGatewayUrl } from '../utils/bulletinCid';
import type { BulletinCidFields } from './useContentRegistry';

const BULLETIN_WS = 'wss://paseo-bulletin-rpc.polkadot.io';

// Matches the SDK's default chunkingThreshold. Above this, unsigned (bare)
// store txs aren't supported by `pallet-transaction-storage`, so we route to
// the signed chunked path instead.
const UNSIGNED_STORE_LIMIT = 2 * 1024 * 1024;

let _bulletinPapiClient: PolkadotClient | null = null;
let _asyncClient: AsyncBulletinClient | null = null;

function getDefaultBulletinClient(): AsyncBulletinClient {
  if (!_bulletinPapiClient) {
    _bulletinPapiClient = createClient(
      withPolkadotSdkCompat(getWsProvider(BULLETIN_WS)),
    );
  }
  if (!_asyncClient) {
    const api = _bulletinPapiClient.getTypedApi(bulletin);
    const aliceSigner = devAccounts[0].signer;
    _asyncClient = new AsyncBulletinClient(api, aliceSigner, (_bulletinPapiClient as any).submit);
  }
  return _asyncClient;
}

/**
 * Upload bytes to Bulletin Chain, returning the CID fields needed for the pallet.
 *
 * Routes by size:
 *  - `<= 2 MiB`: preimage-authorized unsigned store (Alice signs authorizePreimage,
 *    store is a bare tx — the designed feeless path).
 *  - `>  2 MiB`: signed chunked store (Alice pays fees; unsigned path can't chunk
 *    per the SDK, and `pallet-transaction-storage::validate_unsigned` has no
 *    authorization for multi-chunk bare txs).
 *
 * Pass an injectable `_client` for testing (accepts MockBulletinClient).
 */
export async function uploadToBulletin(
  bytes: Uint8Array,
  onProgress?: (pct: number) => void,
  _client?: BulletinClientInterface,
): Promise<BulletinCidFields> {
  const client = _client ?? getDefaultBulletinClient();

  const progressCb: ProgressCallback = (event) => {
    if (event.type === ChunkStatus.ChunkCompleted) {
      onProgress?.(((event.index + 1) / event.total) * 100);
    }
  };

  let result;
  if (bytes.length > UNSIGNED_STORE_LIMIT) {
    // Signed chunked path. Alice (the signer) pays Bulletin fees and supplies
    // account-level authorization. The SDK auto-chunks above `chunkingThreshold`.
    result = await client.store(bytes).withCallback(progressCb).send();
  } else {
    // Preimage-authorized bare-tx path. Feeless for the submitter of `store`,
    // but Alice still pays to authorize the preimage.
    const contentHash = await getContentHash(bytes, HashAlgorithm.Blake2b256);
    await client.authorizePreimage(contentHash, BigInt(bytes.length)).send();
    result = await client.store(bytes).withCallback(progressCb).sendUnsigned();
  }

  onProgress?.(100);

  if (!result.cid) throw new Error('Bulletin upload returned no CID');

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
