import { describe, test, expect, beforeEach } from 'vitest';
import { useChainStore } from './chainStore';

beforeEach(() => {
  useChainStore.setState({ account: null, balance: 0n, connected: false });
});

describe('chainStore initial state', () => {
  test('account is null', () => {
    expect(useChainStore.getState().account).toBeNull();
  });

  test('balance is 0n', () => {
    expect(useChainStore.getState().balance).toBe(0n);
  });

  test('connected is false', () => {
    expect(useChainStore.getState().connected).toBe(false);
  });
});

describe('chainStore setters', () => {
  test('setAccount updates account', () => {
    useChainStore.getState().setAccount('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
    expect(useChainStore.getState().account).toBe('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
  });

  test('setAccount accepts null', () => {
    useChainStore.getState().setAccount('5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY');
    useChainStore.getState().setAccount(null);
    expect(useChainStore.getState().account).toBeNull();
  });

  test('setBalance updates balance', () => {
    useChainStore.getState().setBalance(5_000_000_000n);
    expect(useChainStore.getState().balance).toBe(5_000_000_000n);
  });

  test('setConnected updates connected', () => {
    useChainStore.getState().setConnected(true);
    expect(useChainStore.getState().connected).toBe(true);
  });
});
