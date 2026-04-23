import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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

function makeListing(id: bigint, title: string, purchaseCount = 0, creator = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'): ListingWithStats {
  return {
    id,
    creator,
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

  test('renders total uploads and total earnings header summary', async () => {
    mockFetch.mockResolvedValue([
      makeListing(0n, 'Alpha', 2),
      makeListing(1n, 'Beta', 1),
    ]);
    render(<MemoryRouter><MyListingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    // 2 uploads total
    expect(screen.getByText(/2\s*uploads/i)).toBeInTheDocument();
    // total earnings: (2 + 1) sales × 1 DOT = 3.00 DOT
    expect(screen.getByText(/3\.00 DOT/)).toBeInTheDocument();
    expect(screen.getByText(/total earnings/i)).toBeInTheDocument();
  });

  test('shows error message on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('node offline'));
    render(<MemoryRouter><MyListingsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/node offline/i)).toBeInTheDocument());
  });
});

describe('MyListingsPage as creator profile (/creator/:address)', () => {
  const OTHER = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty';

  beforeEach(() => {
    vi.clearAllMocks();
    setAccount('5Grwva'); // logged in as someone else
  });

  function renderAtCreatorRoute(address: string) {
    return render(
      <MemoryRouter initialEntries={[`/creator/${address}`]}>
        <Routes>
          <Route path="/creator/:address" element={<MyListingsPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  test('fetches listings for the :address param, not the connected account', async () => {
    mockFetch.mockResolvedValue([]);
    renderAtCreatorRoute(OTHER);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(OTHER));
  });

  test('renders full SS58 in the title instead of "My Listings"', async () => {
    mockFetch.mockResolvedValue([]);
    renderAtCreatorRoute(OTHER);
    await waitFor(() => expect(screen.getByRole('heading')).toBeInTheDocument());
    expect(screen.getByRole('heading').textContent).toContain(OTHER);
    expect(screen.queryByText(/^My Listings$/)).toBeNull();
  });

  test('renders totals for other-creator view', async () => {
    mockFetch.mockResolvedValue([
      makeListing(0n, 'Gamma', 3, OTHER),
    ]);
    renderAtCreatorRoute(OTHER);
    await waitFor(() => expect(screen.getByText('Gamma')).toBeInTheDocument());
    expect(screen.getByText(/1\s*upload/i)).toBeInTheDocument();
    expect(screen.getByText(/3\.00 DOT total earnings/i)).toBeInTheDocument();
  });

  test('shows a neutral empty state (no "create your first" CTA) for other creators', async () => {
    mockFetch.mockResolvedValue([]);
    renderAtCreatorRoute(OTHER);
    await waitFor(() =>
      expect(screen.getByText(/no listings for this creator/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: /upload|create/i })).toBeNull();
  });

  test('renders as self view when :address matches connected account', async () => {
    mockFetch.mockResolvedValue([]);
    renderAtCreatorRoute('5Grwva');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /my listings/i })).toBeInTheDocument(),
    );
  });
});
