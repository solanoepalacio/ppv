import { CID } from 'multiformats/cid';
import * as digest from 'multiformats/hashes/digest';

const BLAKE2B_256_CODE = 0xb220;
const IPFS_GATEWAY = 'https://paseo-ipfs.polkadot.io/ipfs';

/**
 * Reconstruct an IPFS CIDv1 string from a pallet BulletinCid's codec + blake2b-256 digest.
 * `codec` is 0x55 (raw) for single-chunk uploads or 0x70 (dag-pb) for chunked.
 */
export function bulletinCidToString(codec: number, digestBytes: Uint8Array): string {
  const mh = digest.create(BLAKE2B_256_CODE, digestBytes);
  return CID.createV1(codec, mh).toString();
}

/**
 * Full Paseo IPFS gateway URL for a pallet BulletinCid.
 */
export function bulletinCidToGatewayUrl(codec: number, digestBytes: Uint8Array): string {
  return `${IPFS_GATEWAY}/${bulletinCidToString(codec, digestBytes)}`;
}
