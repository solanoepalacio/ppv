import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ListingDetailPage from './ListingDetailPage';
import type { Listing } from '../hooks/useContentRegistry';

vi.mock('../hooks/useContentRegistry', () => ({
  fetchListing: vi.fn(),
  hasPurchased: vi.fn(),
  submitPurchaseMaybeBatched: vi.fn(),
}));
vi.mock('../store/chainStore', () => ({
  useChainStore: vi.fn(),
}));
vi.mock('../components/VideoPlayer', () => ({
  default: () => <div data-testid="video-player" />,
}));
vi.mock('../hooks/useEncryptionKey', () => ({
  useEncryptionKey: vi.fn(() => ({
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
    ready: true,
  })),
}));
vi.mock('../hooks/contentLockKeyCache', () => ({
  getCachedKey: vi.fn(() => undefined),
}));

import { fetchListing, hasPurchased, submitPurchaseMaybeBatched } from '../hooks/useContentRegistry';
import { useChainStore } from '../store/chainStore';
const mockFetchListing = fetchListing as ReturnType<typeof vi.fn>;
const mockHasPurchased = hasPurchased as ReturnType<typeof vi.fn>;
const mockSubmitPurchase = submitPurchaseMaybeBatched as ReturnType<typeof vi.fn>;
const mockUseChainStore = useChainStore as unknown as ReturnType<typeof vi.fn>;

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 3n,
    creator: '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
    price: 10_000_000_000n,
    contentCid: { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xaa) },
    thumbnailCid: { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xbb) },
    thumbnailUrl: 'https://example.com/thumb.jpg',
    contentHash: new Uint8Array(32).fill(0xcc),
    title: 'Cool Video',
    description: 'Great content',
    createdAt: 500,
    ...overrides,
  };
}

function renderAtId(id: string, account = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', balance = 50_000_000_000n) {
  mockUseChainStore.mockImplementation((sel: (s: any) => any) =>
    sel({ account, balance }),
  );
  return render(
    <MemoryRouter initialEntries={[`/listing/${id}`]}>
      <Routes>
        <Route path="/listing/:id" element={<ListingDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ListingDetailPage', () => {
  beforeEach(() => vi.clearAllMocks());

  test('shows loading state initially', () => {
    mockFetchListing.mockReturnValue(new Promise(() => {}));
    renderAtId('3');
    expect(document.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Cool Video')).toBeNull();
  });

  test('shows not-found when listing does not exist', async () => {
    mockFetchListing.mockResolvedValue(undefined);
    renderAtId('99');
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeInTheDocument());
  });

  test('shows thumbnail + buy button for unpurchased listing', async () => {
    mockFetchListing.mockResolvedValue(makeListing());
    mockHasPurchased.mockResolvedValue(false);
    renderAtId('3');
    await waitFor(() => expect(screen.getByText('Cool Video')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /buy/i })).toBeInTheDocument();
    expect(screen.queryByTestId('video-player')).toBeNull();
  });

  test('prefixes creator address with "Uploaded by" for non-creator viewers', async () => {
    mockFetchListing.mockResolvedValue(makeListing());
    mockHasPurchased.mockResolvedValue(false);
    renderAtId('3');
    await waitFor(() =>
      expect(
        screen.getByText(
          (_, el) =>
            el?.tagName === 'SPAN' && /^Uploaded by\s+5FHneW.*M694ty$/.test(el.textContent ?? ''),
        ),
      ).toBeInTheDocument(),
    );
  });

  test('does not prefix creator address with "Uploaded by" when viewer is the creator', async () => {
    const creatorAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
    mockFetchListing.mockResolvedValue(makeListing({ creator: creatorAddress }));
    mockHasPurchased.mockResolvedValue(false);
    renderAtId('3', creatorAddress);
    await waitFor(() => expect(screen.getByTestId('video-player')).toBeInTheDocument());
    expect(screen.queryByText(/^Uploaded by\s+5Grwva/)).toBeNull();
  });

  test('disables buy button when balance is insufficient', async () => {
    mockFetchListing.mockResolvedValue(makeListing({ price: 100_000_000_000n }));
    mockHasPurchased.mockResolvedValue(false);
    renderAtId('3', '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY', 5_000_000_000n);
    await waitFor(() => expect(screen.getByRole('button', { name: /buy/i })).toBeDisabled());
    expect(screen.getByText(/not enough/i)).toBeInTheDocument();
  });

  test('shows VideoPlayer for a purchased listing', async () => {
    mockFetchListing.mockResolvedValue(makeListing());
    mockHasPurchased.mockResolvedValue(true);
    renderAtId('3');
    await waitFor(() => expect(screen.getByTestId('video-player')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /buy/i })).toBeNull();
  });

  test('shows VideoPlayer and "Your listing" for the creator', async () => {
    const creatorAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
    mockFetchListing.mockResolvedValue(makeListing({ creator: creatorAddress }));
    mockHasPurchased.mockResolvedValue(false);
    renderAtId('3', creatorAddress);
    await waitFor(() => expect(screen.getByTestId('video-player')).toBeInTheDocument());
    expect(screen.getByText(/your listing/i)).toBeInTheDocument();
  });

  test('does not show "Purchased" when viewer is the creator', async () => {
    const creatorAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';
    mockFetchListing.mockResolvedValue(makeListing({ creator: creatorAddress }));
    mockHasPurchased.mockResolvedValue(false);
    renderAtId('3', creatorAddress);
    await waitFor(() => expect(screen.getByTestId('video-player')).toBeInTheDocument());
    expect(screen.queryByText(/purchased/i)).toBeNull();
  });

  test('hides price and "Purchased" text for a buyer (non-creator) with a purchase', async () => {
    mockFetchListing.mockResolvedValue(makeListing({ price: 100_000_000_000n }));
    mockHasPurchased.mockResolvedValue(true);
    renderAtId('3');
    await waitFor(() => expect(screen.getByTestId('video-player')).toBeInTheDocument());
    expect(screen.queryByText(/purchased/i)).toBeNull();
    expect(screen.queryByText(/10\.0000 DOT/)).toBeNull();
    expect(screen.queryByText(/uploaded by you/i)).toBeNull();
  });

  test('clicking buy calls submitPurchase and transitions to purchased state', async () => {
    mockFetchListing.mockResolvedValue(makeListing());
    mockHasPurchased.mockResolvedValue(false);
    mockSubmitPurchase.mockResolvedValue(undefined);
    renderAtId('3');
    const buyBtn = await screen.findByRole('button', { name: /buy/i });
    fireEvent.click(buyBtn);
    await waitFor(() => expect(screen.getByTestId('video-player')).toBeInTheDocument());
    expect(mockSubmitPurchase).toHaveBeenCalledWith(
      3n,
      expect.any(String),
      expect.any(Uint8Array),
      expect.objectContaining({ onPhase: expect.any(Function) }),
    );
  });

  test('button label advances through signing → confirming → purchased', async () => {
    mockFetchListing.mockResolvedValue(makeListing());
    mockHasPurchased.mockResolvedValue(false);

    let capturedOnPhase: ((p: 'signed' | 'finalized') => void) | undefined;
    let resolvePurchase: (() => void) | undefined;
    mockSubmitPurchase.mockImplementation((_id, _addr, _pk, opts) => {
      capturedOnPhase = opts?.onPhase;
      return new Promise<void>((resolve) => { resolvePurchase = resolve; });
    });

    renderAtId('3');
    const buyBtn = await screen.findByRole('button', { name: /buy for/i });

    fireEvent.click(buyBtn);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /waiting for signature/i })).toBeDisabled(),
    );

    capturedOnPhase!('signed');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirming transaction/i })).toBeDisabled(),
    );

    resolvePurchase!();
    await waitFor(() => expect(screen.getByTestId('video-player')).toBeInTheDocument());
  });

  test('shows listing id with a copy button that writes id to clipboard', async () => {
    mockFetchListing.mockResolvedValue(makeListing());
    mockHasPurchased.mockResolvedValue(false);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderAtId('3');
    await waitFor(() => expect(screen.getByText('Cool Video')).toBeInTheDocument());

    const idRow = screen.getByTestId('listing-id');
    expect(idRow).toHaveTextContent(/3/);

    fireEvent.click(screen.getByRole('button', { name: /copy id/i }));
    expect(writeText).toHaveBeenCalledWith('3');
  });

  test('shows error message when purchase fails', async () => {
    mockFetchListing.mockResolvedValue(makeListing());
    mockHasPurchased.mockResolvedValue(false);
    mockSubmitPurchase.mockRejectedValue(new Error('insufficient funds'));
    renderAtId('3');
    const buyBtn = await screen.findByRole('button', { name: /buy/i });
    fireEvent.click(buyBtn);
    await waitFor(() => expect(screen.getByText(/insufficient funds/i)).toBeInTheDocument());
  });
});
