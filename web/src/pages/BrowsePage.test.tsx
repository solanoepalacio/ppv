import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import BrowsePage from './BrowsePage';
import type { Listing } from '../hooks/useContentRegistry';

vi.mock('../hooks/useContentRegistry', () => ({
  fetchAllListings: vi.fn(),
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});

import { fetchAllListings } from '../hooks/useContentRegistry';
const mockFetch = fetchAllListings as ReturnType<typeof vi.fn>;

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
  beforeEach(() => vi.clearAllMocks());

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
});
