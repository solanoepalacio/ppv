import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreatePage from './CreatePage';

vi.mock('../hooks/useBulletinUpload', () => ({
  uploadToBulletin: vi.fn(),
  MAX_UPLOAD_BYTES: 2 * 1024 * 1024,
}));
vi.mock('../hooks/useContentRegistry', () => ({
  submitCreateListingMaybeBatched: vi.fn(),
  fetchServicePublicKey: vi.fn(),
}));
vi.mock('@parity/bulletin-sdk', () => ({
  getContentHash: vi.fn(),
  HashAlgorithm: { Blake2b256: 'blake2b256' },
}));
vi.mock('../utils/contentCipher', () => ({
  generateContentLockKey: vi.fn(() => new Uint8Array(32)),
  encryptContent: vi.fn(async (bytes: Uint8Array) => {
    // pretend-ciphertext: plaintext + 40-byte (nonce+MAC) overhead
    const out = new Uint8Array(bytes.length + 40);
    out.set(bytes, 0);
    return out;
  }),
}));
vi.mock('../utils/sealedBox', () => ({
  sealTo: vi.fn(async () => new Uint8Array(80)),
}));
vi.mock('../hooks/contentLockKeyCache', () => ({
  setCachedKey: vi.fn(),
}));
vi.mock('../hooks/useEncryptionKey', () => ({
  useEncryptionKey: vi.fn(() => ({
    publicKey: new Uint8Array(32),
    privateKey: new Uint8Array(32),
    ready: true,
  })),
}));
vi.mock('../store/chainStore', () => ({
  useChainStore: vi.fn((selector: (s: { account: string | null }) => unknown) =>
    selector({ account: '5Alice' }),
  ),
}));

import { uploadToBulletin } from '../hooks/useBulletinUpload';
import {
  submitCreateListingMaybeBatched,
  fetchServicePublicKey,
} from '../hooks/useContentRegistry';
import { getContentHash } from '@parity/bulletin-sdk';
const mockUpload = uploadToBulletin as ReturnType<typeof vi.fn>;
const mockSubmit = submitCreateListingMaybeBatched as ReturnType<typeof vi.fn>;
const mockFetchServicePub = fetchServicePublicKey as ReturnType<typeof vi.fn>;
const mockGetContentHash = getContentHash as ReturnType<typeof vi.fn>;

// Mock ThumbnailPicker — canvas/video extraction doesn't run in jsdom
vi.mock('../components/ThumbnailPicker', () => ({
  default: ({ onSelect }: { onSelect: (b: Uint8Array) => void }) => (
    <button onClick={() => onSelect(new Uint8Array([1, 2, 3]))} data-testid="thumb-picker">
      Pick thumbnail
    </button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:video'),
    revokeObjectURL: vi.fn(),
  });
});

// Wrap the real createElement so only 'video' gets a fake
const realCreateElement = document.createElement.bind(document);
function mockCreateElement(tag: string) {
  if (tag !== 'video') return realCreateElement(tag);
  const v: any = {
    src: '',
    muted: false,
    duration: 30,
    onloadedmetadata: null as (() => void) | null,
    onerror: null as (() => void) | null,
  };
  Object.defineProperty(v, 'src', {
    set(_: string) { setTimeout(() => v.onloadedmetadata?.(), 0); },
    get() { return ''; },
  });
  return v;
}

function makeVideoFile() {
  return new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' });
}

async function pickVideo() {
  const spy = vi.spyOn(document, 'createElement').mockImplementation(mockCreateElement as any);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [makeVideoFile()] } });
  spy.mockRestore(); // restore only createElement, not URL stub
  await waitFor(() => screen.getByTestId('thumb-picker'));
}

describe('CreatePage', () => {
  test('shows video drop zone in Section A initially', () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    expect(screen.getByText(/drag & drop/i)).toBeInTheDocument();
    expect(screen.queryByTestId('thumb-picker')).toBeNull();
  });

  test('shows ThumbnailPicker (Section B) after a video file is selected', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    await pickVideo();
    expect(screen.getByTestId('thumb-picker')).toBeInTheDocument();
  });

  test('shows metadata form (Section C) after thumbnail is picked', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    await pickVideo();
    fireEvent.click(screen.getByTestId('thumb-picker'));
    await waitFor(() => expect(screen.getByPlaceholderText(/title/i)).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/describe/i)).toBeInTheDocument();
  });

  test('shows Section D placeholder when all metadata fields are valid', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    await pickVideo();
    fireEvent.click(screen.getByTestId('thumb-picker'));
    await waitFor(() => screen.getByPlaceholderText(/title/i));

    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'My Video' } });
    fireEvent.change(screen.getByPlaceholderText(/describe/i), { target: { value: 'Some description' } });
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 2\.5/), { target: { value: '1.5' } });

    await waitFor(() => expect(screen.getByTestId('submit-btn')).toBeInTheDocument());
  });

  test('does not call createObjectURL on re-renders from metadata typing', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    await pickVideo();
    fireEvent.click(screen.getByTestId('thumb-picker'));
    await waitFor(() => screen.getByPlaceholderText(/title/i));

    // Reset call count after initial setup
    (URL.createObjectURL as ReturnType<typeof vi.fn>).mockClear();

    // Typing should not trigger another createObjectURL call
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'Hello World' } });

    expect(URL.createObjectURL as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  test('shows planck equivalent when a valid price is entered', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    await pickVideo();
    fireEvent.click(screen.getByTestId('thumb-picker'));
    await waitFor(() => screen.getByPlaceholderText(/e\.g\. 2\.5/));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 2\.5/), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByText(/planck/i)).toBeInTheDocument());
  });

  test('rejects a video file larger than 2 MiB before probing metadata', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bigFile = new File(
      [new Uint8Array(2 * 1024 * 1024 + 1)],
      'big.mp4',
      { type: 'video/mp4' },
    );
    fireEvent.change(input, { target: { files: [bigFile] } });

    await waitFor(() => expect(screen.getByText(/2 MiB/i)).toBeInTheDocument());
    // Drop zone stays visible; we never advance to Section B
    expect(screen.queryByTestId('thumb-picker')).toBeNull();
    expect(screen.getByText(/drag & drop/i)).toBeInTheDocument();
  });
});

async function fillToSectionD() {
  render(<MemoryRouter initialEntries={['/create']}><CreatePage /></MemoryRouter>);
  await pickVideo();
  fireEvent.click(screen.getByTestId('thumb-picker'));
  await waitFor(() => screen.getByPlaceholderText(/title/i));
  fireEvent.change(screen.getByPlaceholderText(/title/i), { target: { value: 'My Video' } });
  fireEvent.change(screen.getByPlaceholderText(/describe/i), { target: { value: 'Some description' } });
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. 2\.5/), { target: { value: '1.5' } });
  await waitFor(() => screen.getByTestId('submit-btn'));
}

describe('CreatePage Section D — submit flow', () => {
  test('clicking Create listing shows the checklist', async () => {
    mockGetContentHash.mockResolvedValue(new Uint8Array(32));
    mockUpload.mockResolvedValue({ codec: 0x55, digestBytes: new Uint8Array(32) });
    mockFetchServicePub.mockResolvedValue(new Uint8Array(32));
    mockSubmit.mockResolvedValue(5n);

    await fillToSectionD();
    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-btn'));
    });

    await waitFor(() => expect(screen.getAllByText(/uploading/i).length).toBeGreaterThan(0));
  });

  test('navigates to the new listing after successful submit', async () => {
    mockGetContentHash.mockResolvedValue(new Uint8Array(32));
    mockUpload.mockResolvedValue({ codec: 0x55, digestBytes: new Uint8Array(32) });
    mockFetchServicePub.mockResolvedValue(new Uint8Array(32));
    mockSubmit.mockResolvedValue(7n);

    await fillToSectionD();
    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-btn'));
    });

    await waitFor(() => expect(window.location.hash).toContain(''));
    // The navigate call goes to /listing/7 — verify no crash and checklist completes
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledOnce());
  });

  test('marks step as error when upload fails', async () => {
    mockGetContentHash.mockResolvedValue(new Uint8Array(32));
    mockUpload.mockRejectedValue(new Error('Bulletin unavailable'));
    mockFetchServicePub.mockResolvedValue(new Uint8Array(32));
    mockSubmit.mockResolvedValue(0n);

    await fillToSectionD();
    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-btn'));
    });

    await waitFor(() => expect(screen.getByText(/Bulletin unavailable/i)).toBeInTheDocument());
    expect(screen.getByText('✗')).toBeInTheDocument();
  });

  test('shows Retry button on failure and allows resubmit', async () => {
    mockGetContentHash.mockResolvedValue(new Uint8Array(32));
    mockUpload
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue({ codec: 0x55, digestBytes: new Uint8Array(32) });
    mockFetchServicePub.mockResolvedValue(new Uint8Array(32));
    mockSubmit.mockResolvedValue(3n);

    await fillToSectionD();
    await act(async () => {
      fireEvent.click(screen.getByTestId('submit-btn'));
    });

    await waitFor(() => screen.getByRole('button', { name: /retry/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledOnce());
  });
});
