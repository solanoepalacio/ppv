import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ThumbnailPicker from './ThumbnailPicker';

// Stub URL APIs (jsdom doesn't implement them fully)
beforeEach(() => {
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:frame'),
    revokeObjectURL: vi.fn(),
  });
});

const realCreateElement = document.createElement.bind(document);

// Helper: make extractFrames resolve with N fake frame byte arrays
function stubVideoWithFrames(_frameCount: number) {
  const mockVideo = {
    src: '',
    muted: false,
    preload: '',
    duration: 10,
    videoWidth: 320,
    videoHeight: 180,
    onloadedmetadata: null as (() => void) | null,
    onseeked: null as (() => void) | null,
    onerror: null as (() => void) | null,
    set currentTime(_: number) {
      // Trigger onseeked on next tick
      setTimeout(() => this.onseeked?.(), 0);
    },
  };

  const mockCanvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage: vi.fn() })),
    toBlob: vi.fn((cb: (b: Blob | null) => void) => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
      // Give the blob an arrayBuffer method
      (blob as any).arrayBuffer = () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer);
      cb(blob);
    }),
  };

  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'video') return mockVideo as any;
    if (tag === 'canvas') return mockCanvas as any;
    return realCreateElement(tag);
  });

  // Trigger onloadedmetadata after a tick
  setTimeout(() => mockVideo.onloadedmetadata?.(), 0);

  return { mockVideo, mockCanvas };
}

describe('ThumbnailPicker', () => {
  beforeEach(() => vi.clearAllMocks());

  test('shows loading state initially', () => {
    stubVideoWithFrames(3);
    const file = new File([new Uint8Array(8)], 'test.mp4', { type: 'video/mp4' });
    render(<ThumbnailPicker videoFile={file} onSelect={vi.fn()} />);
    expect(screen.getByText(/extracting/i)).toBeInTheDocument();
  });

  test('calls onSelect with bytes when a frame is clicked', async () => {
    stubVideoWithFrames(3);
    const onSelect = vi.fn();
    const file = new File([new Uint8Array(8)], 'test.mp4', { type: 'video/mp4' });
    render(<ThumbnailPicker videoFile={file} onSelect={onSelect} />);

    await waitFor(() => expect(screen.queryByText(/extracting/i)).toBeNull(), { timeout: 2000 });

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith(expect.any(Uint8Array));
  });
});
