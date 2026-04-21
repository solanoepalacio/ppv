import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
} from '@polkadot-labs/hdkd-helpers';
import { getPolkadotSigner } from 'polkadot-api/signer';
import { type PolkadotSigner } from 'polkadot-api';

const entropy = mnemonicToEntropy(DEV_PHRASE);
const miniSecret = entropyToMiniSecret(entropy);
const derive = sr25519CreateDerive(miniSecret);
const aliceKeypair = derive('//Alice');

const _aliceSigner: PolkadotSigner = getPolkadotSigner(
  aliceKeypair.publicKey,
  'Sr25519',
  aliceKeypair.sign,
);

/**
 * Alice's PAPI signer. Used ONLY for Bulletin `authorize_account` /
 * `authorize_preimage`. Never use for parachain extrinsics — the user
 * signs those via the extension wallet (see `signerManager.ts`).
 *
 * Alice's keys come from the well-known DEV_PHRASE and are safe only
 * against the local Zombienet dev chain.
 */
export function getAliceSigner(): PolkadotSigner {
  return _aliceSigner;
}
