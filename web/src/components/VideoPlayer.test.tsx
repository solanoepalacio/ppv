import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import VideoPlayer from './VideoPlayer';
import type { BulletinCidFields } from '../hooks/useContentRegistry';

vi.mock('../hooks/useBulletinUpload', () => ({
  fetchFromIpfs: vi.fn(),
}));
vi.mock('../utils/contentHash', () => ({
  verifyContentHash: vi.fn(),
}));

import { fetchFromIpfs } from '../hooks/useBulletinUpload';
import { verifyContentHash } from '../utils/contentHash';
const mockFetch = fetchFromIpfs as ReturnType<typeof vi.fn>;
const mockVerify = verifyContentHash as ReturnType<typeof vi.fn>;

const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32).fill(0xaa) };
const hash = new Uint8Array(32).fill(0xbb);
const videoBytes = new Uint8Array([1, 2, 3, 4]);

// jsdom has no URL.createObjectURL — stub it
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  });
});

describe('VideoPlayer', () => {
  test('shows a loading spinner while fetching', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<VideoPlayer contentCid={cid} contentHash={hash} />);
    // No video element; spinner present (animate-spin class)
    expect(screen.queryByRole('video' as any)).toBeNull();
    expect(document.querySelector('.animate-spin')).toBeTruthy();
  });

  test('renders a video element after successful fetch and integrity pass', async () => {
    mockFetch.mockResolvedValue(videoBytes);
    mockVerify.mockReturnValue(true);
    render(<VideoPlayer contentCid={cid} contentHash={hash} />);
    await waitFor(() => expect(screen.getByText(/Content verified/i)).toBeInTheDocument());
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video!.src).toContain('blob:mock');
  });

  test('shows integrity failure message when hash does not match', async () => {
    mockFetch.mockResolvedValue(videoBytes);
    mockVerify.mockReturnValue(false);
    render(<VideoPlayer contentCid={cid} contentHash={hash} />);
    await waitFor(() =>
      expect(screen.getByText(/integrity check/i)).toBeInTheDocument(),
    );
    expect(document.querySelector('video')).toBeNull();
  });

  test('shows error state and retry button on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('gateway timeout'));
    render(<VideoPlayer contentCid={cid} contentHash={hash} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument());
    expect(screen.getByText(/content storage/i)).toBeInTheDocument();
  });

  test('retries fetch when Retry button is clicked', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue(videoBytes);
    mockVerify.mockReturnValue(true);
    render(<VideoPlayer contentCid={cid} contentHash={hash} />);
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    await waitFor(() => expect(screen.getByText(/Content verified/i)).toBeInTheDocument());
  });
});
