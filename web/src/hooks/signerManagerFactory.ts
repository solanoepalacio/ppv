// web/src/hooks/signerManagerFactory.ts
//
// Small wallet-connect manager over @polkadot-api/pjs-signer.
// Talks to any polkadot-js-compatible browser extension (Talisman, SubWallet,
// Polkadot.js, Nova). The returned accounts already expose a PAPI-native
// `polkadotSigner`, so no extra wrapping is needed.
import {
  connectInjectedExtension,
  getInjectedExtensions,
  type InjectedExtension,
  type InjectedPolkadotAccount,
} from '@polkadot-api/pjs-signer';
import type { PolkadotSigner } from 'polkadot-api';

export type SignerStatus = 'disconnected' | 'connecting' | 'connected';

export interface SignerAccount {
  address: string;
  name?: string;
}

export interface SignerState {
  status: SignerStatus;
  accounts: SignerAccount[];
  selectedAccount: SignerAccount | null;
  extension: string | null;
  error: Error | null;
}

export interface ConnectResult {
  ok: boolean;
  error?: Error;
}

export interface SignerManager {
  getState(): SignerState;
  subscribe(cb: (s: SignerState) => void): () => void;
  connect(extensionName?: string): Promise<ConnectResult>;
  selectAccount(address: string): void;
  getSigner(): PolkadotSigner | null;
  disconnect(): void;
  silentReconnect(): Promise<ConnectResult>;
}

interface Persisted {
  extension: string;
  address?: string;
}

const PERSIST_KEY = 'ppview.signer';
const DAPP_NAME = 'ppview';
// Talisman first when multiple wallets are installed; this is a Talisman-
// centric build per CLAUDE.md spec and the user's ask.
const PREFERRED_ORDER = ['talisman', 'polkadot-js', 'subwallet-js'];

function loadPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Persisted;
  } catch {
    return null;
  }
}

function savePersisted(p: Persisted | null): void {
  try {
    if (p === null) localStorage.removeItem(PERSIST_KEY);
    else localStorage.setItem(PERSIST_KEY, JSON.stringify(p));
  } catch {
    // localStorage can throw in private modes; non-fatal.
  }
}

function toAccount(a: InjectedPolkadotAccount): SignerAccount {
  return { address: a.address, name: a.name };
}

function pickExtension(requested?: string): string | null {
  const available = getInjectedExtensions();
  if (requested) {
    return available.includes(requested) ? requested : null;
  }
  for (const name of PREFERRED_ORDER) {
    if (available.includes(name)) return name;
  }
  return available[0] ?? null;
}

export function createSignerManager(): SignerManager {
  let state: SignerState = {
    status: 'disconnected',
    accounts: [],
    selectedAccount: null,
    extension: null,
    error: null,
  };

  const listeners = new Set<(s: SignerState) => void>();
  let activeExtension: InjectedExtension | null = null;
  let unsubscribeAccounts: (() => void) | null = null;
  // Keyed by address so getSigner() can return the live PolkadotSigner.
  let signerByAddress = new Map<string, PolkadotSigner>();

  function setState(next: Partial<SignerState>): void {
    state = { ...state, ...next };
    listeners.forEach(cb => cb(state));
  }

  function refreshAccounts(injected: InjectedPolkadotAccount[]): void {
    const accounts = injected.map(toAccount);
    signerByAddress = new Map(injected.map(a => [a.address, a.polkadotSigner]));
    // Preserve current selection if still present; otherwise clear it.
    const current = state.selectedAccount?.address;
    const stillPresent = current && accounts.some(a => a.address === current);
    const selected = stillPresent
      ? accounts.find(a => a.address === current) ?? null
      : state.selectedAccount;
    setState({
      accounts,
      selectedAccount: stillPresent ? selected : null,
    });
  }

  function detachExtension(): void {
    unsubscribeAccounts?.();
    unsubscribeAccounts = null;
    try {
      activeExtension?.disconnect();
    } catch {
      // Some extensions throw on disconnect; ignore.
    }
    activeExtension = null;
    signerByAddress = new Map();
  }

  async function connect(extensionName?: string): Promise<ConnectResult> {
    const name = pickExtension(extensionName);
    if (!name) {
      const error = new Error(
        extensionName
          ? `Wallet extension "${extensionName}" is not installed`
          : 'No compatible wallet extension found',
      );
      setState({ status: 'disconnected', error });
      return { ok: false, error };
    }

    setState({ status: 'connecting', error: null });
    try {
      detachExtension();
      const ext = await connectInjectedExtension(name, DAPP_NAME);
      activeExtension = ext;
      unsubscribeAccounts = ext.subscribe(accts => refreshAccounts(accts));
      const accounts = ext.getAccounts().map(toAccount);
      signerByAddress = new Map(
        ext.getAccounts().map(a => [a.address, a.polkadotSigner]),
      );

      // Restore persisted selection if that address is still visible.
      const persisted = loadPersisted();
      const restore =
        persisted?.extension === name && persisted.address
          ? accounts.find(a => a.address === persisted.address) ?? null
          : null;

      setState({
        status: 'connected',
        extension: name,
        accounts,
        selectedAccount: restore,
        error: null,
      });
      savePersisted({ extension: name, address: restore?.address });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      detachExtension();
      setState({
        status: 'disconnected',
        extension: null,
        accounts: [],
        selectedAccount: null,
        error,
      });
      return { ok: false, error };
    }
  }

  function selectAccount(address: string): void {
    const match = state.accounts.find(a => a.address === address) ?? null;
    setState({ selectedAccount: match });
    if (state.extension) {
      savePersisted({ extension: state.extension, address: match?.address });
    }
  }

  function getSigner(): PolkadotSigner | null {
    const addr = state.selectedAccount?.address;
    if (!addr) return null;
    return signerByAddress.get(addr) ?? null;
  }

  function disconnect(): void {
    detachExtension();
    setState({
      status: 'disconnected',
      accounts: [],
      selectedAccount: null,
      extension: null,
      error: null,
    });
    savePersisted(null);
  }

  async function silentReconnect(): Promise<ConnectResult> {
    const persisted = loadPersisted();
    if (!persisted?.extension) {
      return { ok: false };
    }
    return connect(persisted.extension);
  }

  return {
    getState: () => state,
    subscribe: cb => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    connect,
    selectAccount,
    getSigner,
    disconnect,
    silentReconnect,
  };
}
