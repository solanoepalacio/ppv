// web/src/hooks/signerManager.test.ts
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PolkadotSigner } from 'polkadot-api';
import type { InjectedPolkadotAccount } from '@polkadot-api/pjs-signer';

// Shared mutable state that the pjs-signer mock reads on each call.
// `vi.hoisted` pushes the initializer above `vi.mock` so the factory
// can close over it without referencing hoisted imports.
const pjs = vi.hoisted(() => ({
  extensions: [] as string[],
  accounts: [] as InjectedPolkadotAccount[],
  connectError: null as Error | null,
  subscribers: [] as Array<(a: InjectedPolkadotAccount[]) => void>,
}));

vi.mock('@polkadot-api/pjs-signer', () => ({
  getInjectedExtensions: () => [...pjs.extensions],
  connectInjectedExtension: vi.fn(async (name: string) => {
    if (pjs.connectError) throw pjs.connectError;
    if (!pjs.extensions.includes(name)) {
      throw new Error(`extension "${name}" not installed`);
    }
    return {
      name,
      getAccounts: () => [...pjs.accounts],
      subscribe: (cb: (a: InjectedPolkadotAccount[]) => void) => {
        pjs.subscribers.push(cb);
        return () => {
          pjs.subscribers = pjs.subscribers.filter(s => s !== cb);
        };
      },
      disconnect: () => {},
    };
  }),
}));

function makeAccount(address: string, name: string): InjectedPolkadotAccount {
  const signer = {
    publicKey: new Uint8Array(32),
    signTx: vi.fn(),
    signBytes: vi.fn(),
  } as unknown as PolkadotSigner;
  return {
    address,
    name,
    polkadotSigner: signer,
  } as InjectedPolkadotAccount;
}

describe('signerManager', () => {
  beforeEach(() => {
    pjs.extensions = [];
    pjs.accounts = [];
    pjs.connectError = null;
    pjs.subscribers = [];
    localStorage.clear();
    vi.clearAllMocks();
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

  test('connect() discovers talisman and populates accounts', async () => {
    pjs.extensions = ['talisman'];
    pjs.accounts = [makeAccount('5Grw...', 'Demo')];
    const { manager } = await import('./signerManager');
    const result = await manager.connect();
    expect(result.ok).toBe(true);
    expect(manager.getState().status).toBe('connected');
    expect(manager.getState().accounts).toHaveLength(1);
    expect(manager.getState().accounts[0].address).toBe('5Grw...');
    expect(manager.getState().extension).toBe('talisman');
  });

  test('selectAccount exposes polkadotSigner via getUserSigner', async () => {
    pjs.extensions = ['talisman'];
    const acct = makeAccount('5Grw...', 'Demo');
    pjs.accounts = [acct];
    const { manager, getUserSigner, getUserAddress } = await import('./signerManager');
    await manager.connect();
    manager.selectAccount('5Grw...');
    expect(getUserAddress()).toBe('5Grw...');
    expect(getUserSigner()).toBe(acct.polkadotSigner);
  });

  test('bridge pushes selected address into chainStore', async () => {
    pjs.extensions = ['talisman'];
    pjs.accounts = [makeAccount('5Grw...', 'Demo')];
    const { manager } = await import('./signerManager');
    const { useChainStore } = await import('../store/chainStore');
    await manager.connect();
    manager.selectAccount('5Grw...');
    expect(useChainStore.getState().account).toBe('5Grw...');
  });

  test('useSignerState re-renders on selection change', async () => {
    pjs.extensions = ['talisman'];
    const acct = makeAccount('5Grw...', 'Demo');
    pjs.accounts = [acct];
    const { manager, useSignerState } = await import('./signerManager');
    // Let the module-level silent connect settle (no-op: no persisted state).
    await new Promise(r => setTimeout(r, 0));
    const { result } = renderHook(() => useSignerState());
    await act(async () => {
      await manager.connect();
      manager.selectAccount('5Grw...');
    });
    expect(result.current.selectedAccount?.address).toBe('5Grw...');
  });

  test('no silent-reconnect when nothing persisted (avoids unprompted popup)', async () => {
    pjs.extensions = ['talisman'];
    pjs.accounts = [makeAccount('5Grw...', 'Demo')];
    const pjsModule = await import('@polkadot-api/pjs-signer');
    const { manager } = await import('./signerManager');
    await new Promise(r => setTimeout(r, 0));
    expect(pjsModule.connectInjectedExtension).not.toHaveBeenCalled();
    expect(manager.getState().status).toBe('disconnected');
  });

  test('silent-reconnect restores persisted extension + selection', async () => {
    pjs.extensions = ['talisman'];
    pjs.accounts = [makeAccount('5Grw...', 'Demo')];
    localStorage.setItem(
      'ppview.signer',
      JSON.stringify({ extension: 'talisman', address: '5Grw...' }),
    );
    const { manager } = await import('./signerManager');
    // Wait for the silent-connect microtask chain to settle.
    await new Promise(r => setTimeout(r, 0));
    await new Promise(r => setTimeout(r, 0));
    expect(manager.getState().status).toBe('connected');
    expect(manager.getState().selectedAccount?.address).toBe('5Grw...');
  });

  test('connect fails cleanly when extension not installed', async () => {
    pjs.extensions = []; // nothing installed
    const { manager } = await import('./signerManager');
    const result = await manager.connect('talisman');
    expect(result.ok).toBe(false);
    expect(manager.getState().status).toBe('disconnected');
    expect(manager.getState().error).toBeInstanceOf(Error);
  });

  test('connect() with no installed extensions returns ok:false', async () => {
    pjs.extensions = [];
    const { manager } = await import('./signerManager');
    const result = await manager.connect();
    expect(result.ok).toBe(false);
    expect(manager.getState().status).toBe('disconnected');
  });

  test('disconnect clears state and localStorage', async () => {
    pjs.extensions = ['talisman'];
    pjs.accounts = [makeAccount('5Grw...', 'Demo')];
    const { manager } = await import('./signerManager');
    await manager.connect();
    manager.selectAccount('5Grw...');
    expect(localStorage.getItem('ppview.signer')).not.toBeNull();
    manager.disconnect();
    expect(manager.getState().status).toBe('disconnected');
    expect(manager.getState().accounts).toEqual([]);
    expect(manager.getState().selectedAccount).toBeNull();
    expect(localStorage.getItem('ppview.signer')).toBeNull();
  });

  test('subscribe fires on account list changes from the extension', async () => {
    pjs.extensions = ['talisman'];
    pjs.accounts = [makeAccount('5Grw...', 'A')];
    const { manager } = await import('./signerManager');
    await manager.connect();
    expect(manager.getState().accounts).toHaveLength(1);
    // Simulate extension pushing a new account list.
    const b = makeAccount('5HBu...', 'B');
    pjs.subscribers.forEach(cb => cb([b]));
    expect(manager.getState().accounts).toHaveLength(1);
    expect(manager.getState().accounts[0].address).toBe('5HBu...');
  });
});
