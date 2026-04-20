import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BrowsePage from './BrowsePage';
import type { Listing } from '../hooks/useContentRegistry';

vi.mock('../hooks/useContentRegistry', () => ({
  fetchAllListings: vi.fn(),
  fetchPurchases: vi.fn(),
}));
vi.mock('../store/chainStore', () => ({
  useChainStore: vi.fn(),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { fetchAllListings, fetchPurchases } from '../hooks/useContentRegistry';
import { useChainStore } from '../store/chainStore';
const mockFetch = fetchAllListings as ReturnType<typeof vi.fn>;
const mockFetchPurchases = fetchPurchases as ReturnType<typeof vi.fn>;
const mockUseChainStore = useChainStore as unknown as ReturnType<typeof vi.fn>;

function setAccount(account: string | null) {
  mockUseChainStore.mockImplementation((sel: (s: any) => any) => sel({ account }));
}

function makeListing(id: bigint, title: string): Listing {
  return {
    id,
    creator: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    price: 10_000_000_000n,
    contentCid: { codec: 0x55, digestBytes: new Uint8Array(32) },
    thumbnailCid: { codec: 0x55, digestBytes: new Uint8Array(32) },
    thumbnailUrl: 'https://example.com/thumb.jpg',
    contentHash: new Uint8Array(32),
    title,
    description: '',
    createdAt: 0,
  };
}

describe('BrowsePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAccount('5Grwva');
    mockFetchPurchases.mockResolvedValue([]);
  });

  test('shows skeleton cards while loading', () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    // Skeletons render as animated divs; verify no listing titles appear yet
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Browse')).toBeInTheDocument();
  });

  test('shows empty state when there are no listings', async () => {
    mockFetch.mockResolvedValue([]);
    render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/No listings yet/i)).toBeInTheDocument());
  });

  test('shows listing cards after data loads', async () => {
    mockFetch.mockResolvedValue([
      makeListing(0n, 'Video Alpha'),
      makeListing(1n, 'Video Beta'),
    ]);
    render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Video Alpha')).toBeInTheDocument());
    expect(screen.getByText('Video Beta')).toBeInTheDocument();
  });

  test('shows listing count after data loads', async () => {
    mockFetch.mockResolvedValue([makeListing(0n, 'A'), makeListing(1n, 'B')]);
    render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('2 listings')).toBeInTheDocument());
  });

  test('shows error message on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('network timeout'));
    render(<MemoryRouter><BrowsePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/network timeout/i)).toBeInTheDocument());
  });

  test('marks purchased listings as "Purchased" instead of showing the price', async () => {
    const account = '5Grwva';
    setAccount(account);
    mockFetch.mockResolvedValue([
      makeListing(0n, 'Bought It'),
      makeListing(1n, 'Not Bought'),
    ]);
    mockFetchPurchases.mockResolvedValue([{ listingId: 0n, blockNumber: 42 }]);

    render(<MemoryRouter><BrowsePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Bought It')).toBeInTheDocument());
    expect(mockFetchPurchases).toHaveBeenCalledWith(account);

    // Listing 0 shows "Purchased", listing 1 still shows its price.
    expect(screen.getByText(/^purchased$/i)).toBeInTheDocument();
    // "Not Bought" listing still displays the price.
    expect(screen.getAllByText(/1\.00 DOT/).length).toBeGreaterThan(0);
  });

  test('does not fetch purchases when no account is connected', async () => {
    setAccount(null);
    mockFetch.mockResolvedValue([makeListing(0n, 'Anon Browse')]);

    render(<MemoryRouter><BrowsePage /></MemoryRouter>);

    await waitFor(() => expect(screen.getByText('Anon Browse')).toBeInTheDocument());
    expect(mockFetchPurchases).not.toHaveBeenCalled();
    expect(screen.queryByText(/^purchased$/i)).toBeNull();
  });
});
