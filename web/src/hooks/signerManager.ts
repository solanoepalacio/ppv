// web/src/hooks/signerManager.ts
import { useSyncExternalStore } from 'react';
import type { PolkadotSigner } from 'polkadot-api';
import type { SignerState } from '@polkadot-apps/signer';
import { useChainStore } from '../store/chainStore';
import { createSignerManager } from './signerManagerFactory';

export const manager = createSignerManager();

// Bridge selected-account address into zustand for downstream consumers.
// Subscription lives for the lifetime of the app — the returned unsubscribe
// is intentionally discarded.
void manager.subscribe((state: SignerState) => {
  const addr = state.selectedAccount?.address ?? null;
  if (useChainStore.getState().account !== addr) {
    useChainStore.getState().setAccount(addr);
  }
});

export function getUserSigner(): PolkadotSigner {
  const signer = manager.getSigner();
  if (!signer) throw new Error('No user signer — no account selected');
  return signer;
}

export function getUserAddress(): string | null {
  return manager.getState().selectedAccount?.address ?? null;
}

// Stable references required by useSyncExternalStore.
const subscribeListener = (cb: () => void) => manager.subscribe(() => cb());
const getSnapshot = (): SignerState => manager.getState();

export function useSignerState(): SignerState {
  return useSyncExternalStore(subscribeListener, getSnapshot);
}
