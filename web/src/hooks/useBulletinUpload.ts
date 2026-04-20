import { createClient, type PolkadotClient } from 'polkadot-api';
import { getWsProvider } from 'polkadot-api/ws-provider/web';
import { withPolkadotSdkCompat } from 'polkadot-api/polkadot-sdk-compat';
import {
  AsyncBulletinClient,
  ChunkStatus,
  HashAlgorithm,
  getContentHash,
  type BulletinClientInterface,
} from '@parity/bulletin-sdk';
import { bulletin } from '@polkadot-api/descriptors';
import { devAccounts } from './useAccount';
import { bulletinCidToGatewayUrl } from '../utils/bulletinCid';
import type { BulletinCidFields } from './useContentRegistry';

const BULLETIN_WS = 'wss://paseo-bulletin-rpc.polkadot.io';

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
 * Uses preimage-authorized unsigned store (Alice signs authorizePreimage; store is unsigned).
 * Pass an injectable `_client` for testing (accepts MockBulletinClient).
 */
export async function uploadToBulletin(
  bytes: Uint8Array,
  onProgress?: (pct: number) => void,
  _client?: BulletinClientInterface,
): Promise<BulletinCidFields> {
  const client = _client ?? getDefaultBulletinClient();

  const contentHash = await getContentHash(bytes, HashAlgorithm.Blake2b256);
  await client.authorizePreimage(contentHash, BigInt(bytes.length)).send();

  const result = await client
    .store(bytes)
    .withCallback((event) => {
      if (event.type === ChunkStatus.ChunkCompleted) {
        onProgress?.(((event.index + 1) / event.total) * 100);
      }
    })
    .sendUnsigned();

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
