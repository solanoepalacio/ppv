import { create } from 'zustand';

interface ChainState {
  account: string | null;
  balance: bigint;
  connected: boolean;
  setAccount: (account: string | null) => void;
  setBalance: (balance: bigint) => void;
  setConnected: (connected: boolean) => void;
}

export const useChainStore = create<ChainState>((set) => ({
  account: null,
  balance: 0n,
  connected: false,
  setAccount: (account) => set({ account }),
  setBalance: (balance) => set({ balance }),
  setConnected: (connected) => set({ connected }),
}));
