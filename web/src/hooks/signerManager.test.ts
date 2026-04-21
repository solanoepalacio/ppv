// web/src/hooks/signerManager.test.ts
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PolkadotSigner } from 'polkadot-api';
import type { SignerAccount } from '@polkadot-apps/signer';

// Shared mutable state that the stub provider reads on `connect()`.
// `vi.hoisted` pushes the initializer above the `vi.mock` factory so the
// factory can close over it without referencing hoisted imports.
const stubState = vi.hoisted(() => ({
  accounts: [] as unknown[],
}));

vi.mock('./signerManagerFactory', async () => {
  const { SignerManager } = await import('@polkadot-apps/signer');
  return {
    createSignerManager: () => new SignerManager({
      dappName: 'ppview-test',
      ss58Prefix: 42,
      persistence: null, // disable localStorage in tests
      createProvider: () => ({
        type: 'extension' as const,
        connect: async () => ({ ok: true, value: stubState.accounts as SignerAccount[] }),
        disconnect: () => {},
        onStatusChange: () => () => {},
        onAccountsChange: () => () => {},
      }),
    }),
  };
});

function makeStubAccount(address: string, name: string): SignerAccount {
  const pk = new Uint8Array(32);
  const signer = {
    publicKey: pk,
    signTx: vi.fn(),
    signBytes: vi.fn(),
  } as unknown as PolkadotSigner;
  return {
    address,
    h160Address: '0x0000000000000000000000000000000000000000',
    publicKey: pk,
    name,
    source: 'extension',
    getSigner: () => signer,
  };
}

describe('signerManager', () => {
  beforeEach(() => {
    stubState.accounts = [];
    vi.resetModules();
  });

  test('getUserSigner throws when no account selected', async () => {
    const { getUserSigner } = await import('./signerManager');
    expect(() => getUserSigner()).toThrow(/No user signer/);
  });

  test('getUserAddress returns null when disconnected', async () => {
    const { getUserAddress } = await import('./signerManager');
    expect(getUserAddress()).toBeNull();
  });

  test('selecting an account exposes its PolkadotSigner via getUserSigner', async () => {
    const acct = makeStubAccount('5Grw...', 'Demo');
    stubState.accounts = [acct];
    const { manager, getUserSigner, getUserAddress } = await import('./signerManager');
    const result = await manager.connect('extension');
    expect(result.ok).toBe(true);
    manager.selectAccount(acct.address);
    expect(getUserAddress()).toBe(acct.address);
    expect(getUserSigner()).toBe(acct.getSigner());
  });

  test('bridge pushes selectedAccount address into chainStore', async () => {
    const acct = makeStubAccount('5Grw...', 'Demo');
    stubState.accounts = [acct];
    const { manager } = await import('./signerManager');
    const { useChainStore } = await import('../store/chainStore');
    await manager.connect('extension');
    manager.selectAccount(acct.address);
    expect(useChainStore.getState().account).toBe(acct.address);
  });

  test('useSignerState re-renders on selection change', async () => {
    const acct = makeStubAccount('5Grw...', 'Demo');
    stubState.accounts = [acct];
    const { manager, useSignerState } = await import('./signerManager');
    // Allow the module-level silent connect to settle before rendering.
    await new Promise(r => setTimeout(r, 0));
    const { result } = renderHook(() => useSignerState());
    // Re-connect explicitly and verify the hook reflects the new selection.
    await act(async () => {
      await manager.connect('extension');
      manager.selectAccount(acct.address);
    });
    expect(result.current.selectedAccount?.address).toBe(acct.address);
  });

  test('auto-connects on module load when connect() succeeds', async () => {
    const acct = makeStubAccount('5Grw...', 'Demo');
    stubState.accounts = [acct];
    // Fresh import triggers the silent connect.
    const { manager } = await import('./signerManager');
    // Yield to the event loop so the silent connect can settle.
    await new Promise(r => setTimeout(r, 0));
    expect(manager.getState().status).toBe('connected');
  });

  test('remains disconnected when silent connect fails', async () => {
    vi.resetModules();
    vi.doMock('./signerManagerFactory', async () => {
      const { SignerManager } = await import('@polkadot-apps/signer');
      return {
        createSignerManager: () => new SignerManager({
          dappName: 'ppview-test',
          ss58Prefix: 42,
          persistence: null,
          createProvider: () => ({
            type: 'extension' as const,
            connect: async () => ({ ok: false, error: new Error('no extension') }),
            disconnect: () => {},
            onStatusChange: () => () => {},
            onAccountsChange: () => () => {},
          }),
        }),
      };
    });
    const { manager } = await import('./signerManager');
    await new Promise(r => setTimeout(r, 0));
    expect(manager.getState().status).toBe('disconnected');
    vi.doUnmock('./signerManagerFactory');
  });
});
