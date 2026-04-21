// web/src/hooks/signerManagerFactory.ts
import { SignerManager } from '@polkadot-apps/signer';

export function createSignerManager(): SignerManager {
  return new SignerManager({
    dappName: 'ppview',
    ss58Prefix: 42,
    // persistence defaults to localStorage in browser, no-op in node
  });
}
