import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import VideoPlayer from './VideoPlayer';
import type { BulletinCidFields } from '../hooks/useContentRegistry';

// Mocks for network + chain dependencies
vi.mock('../hooks/useBulletinUpload', () => ({
  fetchFromIpfs: vi.fn(),
}));
vi.mock('../hooks/useContentRegistry', async (orig) => {
  const actual = await orig<typeof import('../hooks/useContentRegistry')>();
  return {
    ...actual,
    watchWrappedKey: vi.fn(),
  };
});

import { fetchFromIpfs } from '../hooks/useBulletinUpload';
import { watchWrappedKey } from '../hooks/useContentRegistry';
import { encryptContent, generateContentLockKey } from '../utils/contentCipher';
import { sealTo } from '../utils/sealedBox';
import { generateKeypair } from '../utils/encryptionKey';
import { blake2b } from 'blakejs';

const cid: BulletinCidFields = { codec: 0x55, digestBytes: new Uint8Array(32) };

beforeEach(() => {
  vi.mocked(fetchFromIpfs).mockReset();
  vi.mocked(watchWrappedKey).mockReset();
  // URL.createObjectURL isn't available in jsdom
  (global as any).URL.createObjectURL = vi.fn(() => 'blob:fake');
  (global as any).URL.revokeObjectURL = vi.fn();
});

describe('VideoPlayer (Phase 2)', () => {
  it('shows "preparing" until the wrapped key lands', async () => {
    vi.mocked(watchWrappedKey).mockImplementation((_a, _id, cb) => {
      cb(null);
      return { unsubscribe: () => {} };
    });
    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={new Uint8Array(32)}
        listingId={1n}
        currentAccount="5Grw"
        viewerPrivateKey={new Uint8Array(32)}
        viewerPublicKey={new Uint8Array(32)}
      />,
    );
    expect(await screen.findByText(/preparing/i)).toBeInTheDocument();
  });

  it('decrypts from WrappedKeys and renders a video blob', async () => {
    const viewer = await generateKeypair();
    const clk = generateContentLockKey();

    const plaintext = new Uint8Array([7, 7, 7, 7]);
    const ciphertext = await encryptContent(plaintext, clk);
    const hash = blake2b(plaintext, undefined, 32);
    const sealed = await sealTo(viewer.publicKey, clk);

    vi.mocked(fetchFromIpfs).mockResolvedValue(ciphertext);
    vi.mocked(watchWrappedKey).mockImplementation((_a, _id, cb) => {
      cb(sealed);
      return { unsubscribe: () => {} };
    });

    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={hash}
        listingId={1n}
        currentAccount="5Grw"
        viewerPublicKey={viewer.publicKey}
        viewerPrivateKey={viewer.privateKey}
      />,
    );

    await waitFor(() => expect(screen.getByText(/content verified/i)).toBeInTheDocument());
  });

  it('uses the cached CLK when provided (creator fast-path)', async () => {
    const clk = generateContentLockKey();
    const plaintext = new Uint8Array([1, 2, 3]);
    const ciphertext = await encryptContent(plaintext, clk);
    const hash = blake2b(plaintext, undefined, 32);

    vi.mocked(fetchFromIpfs).mockResolvedValue(ciphertext);

    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={hash}
        listingId={2n}
        currentAccount="5Grw"
        viewerPublicKey={new Uint8Array(32)}
        viewerPrivateKey={new Uint8Array(32)}
        plaintextKey={clk}
      />,
    );

    await waitFor(() => expect(screen.getByText(/content verified/i)).toBeInTheDocument());
    // We never subscribed because the cached key was sufficient.
    expect(watchWrappedKey).not.toHaveBeenCalled();
  });

  it('flags integrity failure when plaintext hash mismatches', async () => {
    const clk = generateContentLockKey();
    const ciphertext = await encryptContent(new Uint8Array([9]), clk);
    vi.mocked(fetchFromIpfs).mockResolvedValue(ciphertext);

    render(
      <VideoPlayer
        contentCid={cid}
        contentHash={new Uint8Array(32).fill(0x00)}
        listingId={3n}
        currentAccount="5Grw"
        viewerPublicKey={new Uint8Array(32)}
        viewerPrivateKey={new Uint8Array(32)}
        plaintextKey={clk}
      />,
    );

    await waitFor(() => expect(screen.getByText(/integrity check/i)).toBeInTheDocument());
  });
});
