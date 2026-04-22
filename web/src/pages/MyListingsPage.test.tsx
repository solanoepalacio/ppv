import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MyListingsPage from './MyListingsPage';
import type { ListingWithStats } from '../hooks/useContentRegistry';

vi.mock('../hooks/useContentRegistry', () => ({
  fetchListingsByCreator: vi.fn(),
}));
vi.mock('../store/chainStore', () => ({
  useChainStore: vi.fn(),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { fetchListingsByCreator } from '../hooks/useContentRegistry';
import { useChainStore } from '../store/chainStore';
const mockFetch = fetchListingsByCreator as ReturnType<typeof vi.fn>;
const mockUseChainStore = useChainStore as unknown as ReturnType<typeof vi.fn>;

function setAccount(account: string | null) {
  mockUseChainStore.mockImplementation((sel: (s: any) => any) => sel({ account }));
}

function makeListing(id: bigint, title: string, purchaseCount = 0): ListingWithStats {
  return {
    id,
    creator: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    price: 1_000_000_000_000n,
    contentCid: { codec: 0x55, digestBytes: new Uint8Array(32) },
    thumbnailCid: { codec: 0x55, digestBytes: new Uint8Array(32) },
    thumbnailUrl: 'https://example.com/thumb.jpg',
    contentHash: new Uint8Array(32),
    title,
    description: '',
    createdAt: 0,
    purchaseCount,
  };
}

describe('MyListingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccount('5Grwva');
  });

  test('shows connect-wallet prompt when no account is connected', () => {
    setAccount(null);
    render(<MemoryRouter><MyListingsPage /></MemoryRouter>);
    expect(screen.getByText(/connect/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('fetches listings for the connected creator', async () => {
    mockFetch.mockResolvedValue([]);
    render(<MemoryRouter><MyListingsPage /></MemoryRouter>);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('5Grwva'));
  });

  test('shows empty state when the creator has no listings', async () => {
    mockFetch.mockResolvedValue([]);
    render(<MemoryRouter><MyListingsPage /></MemoryRouter>);
    await waitFor(() =>
      expect(screen.getByText(/haven't published anything yet/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /upload|create/i })).toHaveAttribute('href', '/upload');
  });

  test('renders each listing with purchase count + derived earnings', async () => {
    mockFetch.mockResolvedValue([
      makeListing(0n, 'Alpha', 2),
      makeListing(1n, 'Beta', 0),
    ]);
    render(<MemoryRouter><MyListingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/2 sales/i)).toBeInTheDocument();
    expect(screen.getByText(/0 sales/i)).toBeInTheDocument();
    // 2 sales × 1 DOT = 2.00 DOT earned
    expect(screen.getByText(/2\.00 DOT earned/i)).toBeInTheDocument();
  });

  test('shows error message on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('node offline'));
    render(<MemoryRouter><MyListingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/node offline/i)).toBeInTheDocument());
  });
});
