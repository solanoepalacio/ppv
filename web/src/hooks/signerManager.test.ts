import { describe, test, expect } from 'vitest';
import { SignerManager } from '@polkadot-apps/signer';

describe('@polkadot-apps/signer smoke', () => {
  test('SignerManager constructs with defaults', () => {
    const manager = new SignerManager({ dappName: 'ppview', ss58Prefix: 42 });
    const state = manager.getState();
    expect(state.status).toBe('disconnected');
    expect(state.accounts).toEqual([]);
    expect(state.selectedAccount).toBeNull();
    manager.destroy();
  });
});
