import { sr25519CreateDerive } from '@polkadot-labs/hdkd';
import {
  DEV_PHRASE,
  entropyToMiniSecret,
  mnemonicToEntropy,
  ss58Address,
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

const _aliceAddress = ss58Address(aliceKeypair.publicKey, 42);

/**
 * Alice's PAPI signer. Used for all Bulletin extrinsics
 * (`authorize_account` and `store`). The user's extension wallet
 * (Talisman) is intentionally not used against Bulletin because its
 * `withSignedTransaction` path rebuilds extrinsics from its own chain
 * metadata and produces payloads that don't match Bulletin's runtime,
 * yielding BadProof. Parachain extrinsics still use the user wallet
 * via `signerManager.ts`.
 *
 * Alice's keys come from the well-known DEV_PHRASE and are safe only
 * against the local Zombienet dev chain.
 */
export function getAliceSigner(): PolkadotSigner {
  return _aliceSigner;
}

export function getAliceAddress(): string {
  return _aliceAddress;
}
