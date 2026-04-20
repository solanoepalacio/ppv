import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ListingCard from './ListingCard';
import type { Listing } from '../hooks/useContentRegistry';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 0n,
    creator: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
    price: 25_000_000_000n, // 2.5 DOT
    contentCid: { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xaa) },
    thumbnailCid: { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xbb) },
    thumbnailUrl: 'https://example.com/thumb.jpg',
    contentHash: new Uint8Array(32).fill(0xcc),
    title: 'My Test Video',
    description: 'A great video',
    createdAt: 100,
    ...overrides,
  };
}

describe('ListingCard', () => {
  test('renders the listing title', () => {
    render(<MemoryRouter><ListingCard listing={makeListing()} /></MemoryRouter>);
    expect(screen.getByText('My Test Video')).toBeInTheDocument();
  });

  test('renders the creator address prefixed with "By:"', () => {
    render(<MemoryRouter><ListingCard listing={makeListing()} /></MemoryRouter>);
    // Full address is 48 chars; truncated shows first 6 + … + last 6, prefixed with "By:"
    expect(screen.getByText(/^By:\s*5Grwva.*GKutQY$/)).toBeInTheDocument();
  });

  test('renders the price in DOT', () => {
    render(<MemoryRouter><ListingCard listing={makeListing()} /></MemoryRouter>);
    expect(screen.getByText(/2\.50 DOT/)).toBeInTheDocument();
  });

  test('navigates to the listing detail page on click', () => {
    render(<MemoryRouter><ListingCard listing={makeListing({ id: 7n })} /></MemoryRouter>);
    fireEvent.click(screen.getByText('My Test Video'));
    expect(mockNavigate).toHaveBeenCalledWith('/listing/7');
  });

  test('renders the thumbnail image', () => {
    render(<MemoryRouter><ListingCard listing={makeListing()} /></MemoryRouter>);
    const img = screen.getByAltText('My Test Video') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/thumb.jpg');
  });
});
