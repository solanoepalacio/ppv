import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PurchasesPage from './PurchasesPage';

vi.mock('../store/chainStore', () => ({
  useChainStore: vi.fn(),
}));
vi.mock('../hooks/useContentRegistry', () => ({
  fetchPurchases: vi.fn(),
  fetchListing: vi.fn(),
}));

import { useChainStore } from '../store/chainStore';
import { fetchPurchases, fetchListing } from '../hooks/useContentRegistry';
const mockUseChainStore = useChainStore as unknown as ReturnType<typeof vi.fn>;
const mockFetchPurchases = fetchPurchases as ReturnType<typeof vi.fn>;
const mockFetchListing = fetchListing as ReturnType<typeof vi.fn>;

function makeListing(id: bigint) {
  return {
    id,
    creator: '5Alice',
    price: 10_000_000_000n,
    thumbnailUrl: 'https://example.com/thumb.jpg',
    title: `Listing ${id}`,
    description: 'desc',
    createdAt: 1,
    contentCid: { codec: 0x55, digestBytes: new Uint8Array(32) },
    thumbnailCid: { codec: 0x55, digestBytes: new Uint8Array(32) },
    contentHash: new Uint8Array(32),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseChainStore.mockImplementation((sel: (s: { account: string | null }) => unknown) =>
    sel({ account: '5Alice' }),
  );
});

describe('PurchasesPage', () => {
  test('shows skeleton cards while loading', () => {
    mockFetchPurchases.mockReturnValue(new Promise(() => {}));
    render(<MemoryRouter><PurchasesPage /></MemoryRouter>);
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
  });

  test('shows empty state when account has no purchases', async () => {
    mockFetchPurchases.mockResolvedValue([]);
    render(<MemoryRouter><PurchasesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/haven't bought/i)).toBeInTheDocument());
  });

  test('shows empty state when no account is connected', async () => {
    mockUseChainStore.mockImplementation((sel: (s: { account: string | null }) => unknown) =>
      sel({ account: null }),
    );
    render(<MemoryRouter><PurchasesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/haven't bought/i)).toBeInTheDocument());
    expect(mockFetchPurchases).not.toHaveBeenCalled();
  });

  test('renders listing cards for purchased listings', async () => {
    mockFetchPurchases.mockResolvedValue([
      { listingId: 1n, blockNumber: 100 },
      { listingId: 2n, blockNumber: 200 },
    ]);
    mockFetchListing.mockImplementation((id: bigint) => Promise.resolve(makeListing(id)));
    render(<MemoryRouter><PurchasesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Listing 1')).toBeInTheDocument());
    expect(screen.getByText('Listing 2')).toBeInTheDocument();
  });

  test('shows count of purchased listings', async () => {
    mockFetchPurchases.mockResolvedValue([{ listingId: 3n, blockNumber: 50 }]);
    mockFetchListing.mockResolvedValue(makeListing(3n));
    render(<MemoryRouter><PurchasesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/1 purchased/i)).toBeInTheDocument());
  });

  test('shows error message on fetch failure', async () => {
    mockFetchPurchases.mockRejectedValue(new Error('RPC down'));
    render(<MemoryRouter><PurchasesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/RPC down/i)).toBeInTheDocument());
  });

  test('skips listings that cannot be resolved', async () => {
    mockFetchPurchases.mockResolvedValue([
      { listingId: 1n, blockNumber: 100 },
      { listingId: 99n, blockNumber: 200 },
    ]);
    mockFetchListing.mockImplementation((id: bigint) =>
      id === 1n ? Promise.resolve(makeListing(1n)) : Promise.resolve(undefined),
    );
    render(<MemoryRouter><PurchasesPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Listing 1')).toBeInTheDocument());
    expect(screen.queryByText('Listing 99')).toBeNull();
  });
});
