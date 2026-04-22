// web/src/hooks/signerManager.ts
import { useSyncExternalStore } from 'react';
import type { PolkadotSigner } from 'polkadot-api';
import { useChainStore } from '../store/chainStore';
import { createSignerManager, type SignerState } from './signerManagerFactory';

export type { SignerState, SignerAccount, SignerStatus } from './signerManagerFactory';

export const manager = createSignerManager();

// Bridge selected-account address into zustand for downstream consumers.
// Subscription lives for the lifetime of the app — the returned unsubscribe
// is intentionally discarded.
manager.subscribe((state: SignerState) => {
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

// Only reconnect if we have a persisted extension+address — this avoids
// triggering an unprompted wallet authorization popup on first visit.
// Extensions remember dApp authorization per origin, so a silent connect
// after a prior session resolves without UX.
void manager.silentReconnect().catch((err: unknown) => {
  console.warn('[signerManager] silent reconnect threw unexpectedly:', err);
});
