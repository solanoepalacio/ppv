import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SignerState } from '../hooks/signerManager';

const connectMock = vi.fn();
const selectAccountMock = vi.fn();
let mockState: SignerState = {
  status: 'disconnected',
  accounts: [],
  selectedAccount: null,
  extension: null,
  error: null,
};

vi.mock('../hooks/signerManager', () => ({
  manager: {
    connect: (...args: unknown[]) => connectMock(...args),
    selectAccount: (...args: unknown[]) => selectAccountMock(...args),
  },
  useSignerState: () => mockState,
}));

import { WalletPicker } from './WalletPicker';

function resetState(next: Partial<SignerState> = {}): void {
  mockState = {
    status: 'disconnected',
    accounts: [],
    selectedAccount: null,
    extension: null,
    error: null,
    ...next,
  };
}

describe('WalletPicker', () => {
  beforeEach(() => {
    connectMock.mockReset();
    selectAccountMock.mockReset();
    resetState();
  });

  test('renders Connect button when disconnected', () => {
    resetState({ status: 'disconnected' });
    render(<WalletPicker />);
    expect(screen.getByRole('button', { name: /connect wallet/i })).toBeTruthy();
  });

  test('clicking Connect calls manager.connect()', () => {
    resetState({ status: 'disconnected' });
    render(<WalletPicker />);
    fireEvent.click(screen.getByRole('button', { name: /connect wallet/i }));
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  test('shows connecting text when status is connecting', () => {
    resetState({ status: 'connecting' });
    render(<WalletPicker />);
    expect(screen.getByText(/connecting/i)).toBeTruthy();
  });

  test('shows genesis-hash hint when connected with zero accounts', () => {
    resetState({ status: 'connected', accounts: [], extension: 'talisman' });
    render(<WalletPicker />);
    expect(screen.getByText(/allow use on any network/i)).toBeTruthy();
  });

  test('renders account select when connected with accounts', () => {
    const acct = { address: '5Grw...', name: 'Demo' };
    resetState({
      status: 'connected',
      accounts: [acct],
      selectedAccount: acct,
      extension: 'talisman',
    });
    render(<WalletPicker />);
    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();
    expect(screen.getByRole('option', { name: /demo/i })).toBeTruthy();
  });

  test('changing select calls manager.selectAccount', () => {
    const a = { address: '5Grw...', name: 'A' };
    const b = { address: '5HBu...', name: 'B' };
    resetState({
      status: 'connected',
      accounts: [a, b],
      selectedAccount: a,
      extension: 'talisman',
    });
    render(<WalletPicker />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '5HBu...' } });
    expect(selectAccountMock).toHaveBeenCalledWith('5HBu...');
  });
});
