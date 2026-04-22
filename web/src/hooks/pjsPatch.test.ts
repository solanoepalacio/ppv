// Tests for the window.injectedWeb3 patch that forces
// `withSignedTransaction: false` so PAPI's pjs-signer falls through to
// createV4Tx (MultiAddress::Id) instead of submitting the extension's
// rebuilt extrinsic — which on ppview yields CannotLookup via Talisman.
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { patchInjectedWeb3ForPapi } from './pjsPatch';

type PjsPayload = {
  withSignedTransaction?: boolean;
  address: string;
  method: string;
  [k: string]: unknown;
};

// Minimal fake of what a polkadot-js-compatible extension injects as
// `window.injectedWeb3[name]`.
function makeFakeExtensionEntry(opts: {
  signPayloadImpl: (pjs: PjsPayload) => Promise<unknown>;
}) {
  const signPayload = vi.fn(opts.signPayloadImpl);
  const enable = vi.fn(async (_dappName?: string) => ({
    signer: {
      signPayload,
      signRaw: vi.fn(),
    },
    accounts: {
      get: async () => [],
      subscribe: () => () => {},
    },
  }));
  return { entry: { enable, version: '1.0.0' }, enable, signPayload };
}

function setInjected(name: string, entry: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).injectedWeb3 = { ...(window as any).injectedWeb3, [name]: entry };
}

describe('patchInjectedWeb3ForPapi', () => {
  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).injectedWeb3 = {};
  });

  test('forces withSignedTransaction=false when caller passes true', async () => {
    const { entry, signPayload } = makeFakeExtensionEntry({
      signPayloadImpl: async () => ({ signature: '0xdead', id: 1 }),
    });
    setInjected('talisman', entry);

    patchInjectedWeb3ForPapi('talisman');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = await (window as any).injectedWeb3.talisman.enable('ppview');
    await ext.signer.signPayload({
      withSignedTransaction: true,
      address: '5Grw...',
      method: '0x00',
    });

    expect(signPayload).toHaveBeenCalledTimes(1);
    expect(signPayload.mock.calls[0][0].withSignedTransaction).toBe(false);
  });

  test('strips signedTransaction from result to force createV4Tx fallback', async () => {
    const { entry } = makeFakeExtensionEntry({
      signPayloadImpl: async () => ({
        signature: '0xabcd',
        id: 2,
        signedTransaction: '0xfullyrebuiltextrinsic',
      }),
    });
    setInjected('talisman', entry);

    patchInjectedWeb3ForPapi('talisman');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = await (window as any).injectedWeb3.talisman.enable('ppview');
    const result = await ext.signer.signPayload({
      withSignedTransaction: true,
      address: '5Grw...',
      method: '0x00',
    }) as { signature: string; signedTransaction?: string };

    expect(result.signature).toBe('0xabcd');
    expect(result.signedTransaction).toBeUndefined();
  });

  test('idempotent: patching twice does not double-wrap', async () => {
    const { entry, signPayload } = makeFakeExtensionEntry({
      signPayloadImpl: async () => ({ signature: '0x00', id: 1 }),
    });
    setInjected('talisman', entry);

    patchInjectedWeb3ForPapi('talisman');
    patchInjectedWeb3ForPapi('talisman');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = await (window as any).injectedWeb3.talisman.enable('ppview');
    await ext.signer.signPayload({
      withSignedTransaction: true,
      address: '5Grw...',
      method: '0x00',
    });

    // Inner signer called exactly once — not re-wrapped per patch call.
    expect(signPayload).toHaveBeenCalledTimes(1);
  });

  test('no-op when extension is not installed', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).injectedWeb3 = {};
    expect(() => patchInjectedWeb3ForPapi('talisman')).not.toThrow();
  });

  test('preserves signRaw and accounts from the original extension', async () => {
    const signRaw = vi.fn(async () => ({ signature: '0x11', id: 1 }));
    const accountsGet = vi.fn(async () => []);
    const enable = vi.fn(async () => ({
      signer: { signPayload: vi.fn(async () => ({ signature: '0x', id: 1 })), signRaw },
      accounts: { get: accountsGet, subscribe: () => () => {} },
    }));
    setInjected('talisman', { enable, version: '1.0.0' });

    patchInjectedWeb3ForPapi('talisman');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = await (window as any).injectedWeb3.talisman.enable('ppview');
    expect(ext.signer.signRaw).toBe(signRaw);
    expect(ext.accounts.get).toBe(accountsGet);
  });
});
