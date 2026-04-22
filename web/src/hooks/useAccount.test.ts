import { describe, test, expect } from 'vitest';
import { getAliceSigner, getAliceAddress } from './useAccount';
import { ss58Address } from '@polkadot-labs/hdkd-helpers';

describe('useAccount', () => {
  test('getAliceSigner returns a PolkadotSigner for //Alice', () => {
    const signer = getAliceSigner();
    // The //Alice sr25519 public key (well-known):
    //   0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d
    const aliceAddress = ss58Address(signer.publicKey, 42);
    expect(aliceAddress).toBe('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
  });

  test('getAliceSigner returns a stable instance across calls', () => {
    expect(getAliceSigner()).toBe(getAliceSigner());
  });

  test('getAliceAddress returns the SS58 prefix-42 address for //Alice', () => {
    expect(getAliceAddress()).toBe('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
  });
});
