import { manager, useSignerState } from '../hooks/signerManager';
import { truncateAddress } from '../utils/format';

export function WalletPicker() {
  const state = useSignerState();

  if (state.status === 'connecting') {
    return <span className="text-xs text-text-muted">Connecting…</span>;
  }

  if (state.status === 'disconnected') {
    return (
      <button
        type="button"
        onClick={() => { void manager.connect(); }}
        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-polka-500/15 border border-polka-500/25 text-white hover:bg-polka-500/25 transition-colors"
      >
        Connect wallet
      </button>
    );
  }

  if (state.accounts.length === 0) {
    return (
      <span className="text-xs text-accent-yellow max-w-xs">
        No accounts visible. In Talisman, enable "Allow use on any network"
        for the account you want to use.
      </span>
    );
  }

  return (
    <select
      value={state.selectedAccount?.address ?? ''}
      onChange={(e) => { manager.selectAccount(e.target.value); }}
      className="px-2 py-1 rounded-md text-xs font-mono bg-white/[0.04] border border-white/[0.08] text-text-primary max-w-[18rem]"
    >
      {!state.selectedAccount && <option value="">Select account…</option>}
      {state.accounts.map((a) => (
        <option key={a.address} value={a.address}>
          {a.name ?? truncateAddress(a.address)}
        </option>
      ))}
    </select>
  );
}
