import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreatePage from './CreatePage';

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

  test('shows planck equivalent when a valid price is entered', async () => {
    render(<MemoryRouter><CreatePage /></MemoryRouter>);
    await pickVideo();
    fireEvent.click(screen.getByTestId('thumb-picker'));
    await waitFor(() => screen.getByPlaceholderText(/e\.g\. 2\.5/));

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 2\.5/), { target: { value: '1' } });
    await waitFor(() => expect(screen.getByText(/planck/i)).toBeInTheDocument());
  });
});
