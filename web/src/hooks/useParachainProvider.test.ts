import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const watchValueMock = vi.fn();
const subscribeMock = vi.fn();
const unsubscribeMock = vi.fn();

vi.mock('polkadot-api', async (orig) => {
  const actual = await orig<typeof import('polkadot-api')>();
  return {
    ...actual,
    createClient: () => ({
      getTypedApi: () => ({
        query: { System: { Account: { watchValue: watchValueMock } } },
      }),
    }),
  };
});

vi.mock('polkadot-api/ws-provider/web', () => ({
  getWsProvider: vi.fn(() => ({})),
}));

vi.mock('polkadot-api/polkadot-sdk-compat', () => ({
  withPolkadotSdkCompat: vi.fn((t) => t),
}));

vi.mock('@novasamatech/product-sdk', () => ({
  sandboxProvider: { isCorrectEnvironment: () => false },
  createPapiProvider: vi.fn(),
  hostApi: {},
}));

describe('useParachainProvider', () => {
  beforeEach(() => {
    watchValueMock.mockReset();
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    watchValueMock.mockReturnValue({ subscribe: subscribeMock });
    subscribeMock.mockReturnValue({ unsubscribe: unsubscribeMock });
  });

  test('does not subscribe balance while account is null', async () => {
    const { useChainStore } = await import('../store/chainStore');
    useChainStore.setState({ account: null, connected: false });
    const { useParachainProvider } = await import('./useParachainProvider');
    renderHook(() => useParachainProvider());
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(watchValueMock).not.toHaveBeenCalled();
  });

  test('subscribes balance when account becomes non-null', async () => {
    const { useChainStore } = await import('../store/chainStore');
    useChainStore.setState({ account: null, connected: false });
    const { useParachainProvider } = await import('./useParachainProvider');
    renderHook(() => useParachainProvider());
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
      useChainStore.setState({ account: '5Grw...', connected: true });
    });
    expect(watchValueMock).toHaveBeenCalledWith('5Grw...');
    expect(subscribeMock).toHaveBeenCalled();
  });

  test('re-subscribes balance when account changes', async () => {
    const { useChainStore } = await import('../store/chainStore');
    useChainStore.setState({ account: '5Grw...', connected: true });
    const { useParachainProvider } = await import('./useParachainProvider');
    renderHook(() => useParachainProvider());
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
      useChainStore.getState().setAccount('5HBu...');
    });
    expect(unsubscribeMock).toHaveBeenCalled();
    expect(watchValueMock).toHaveBeenCalledWith('5HBu...');
  });
});
