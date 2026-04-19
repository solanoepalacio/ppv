import { useState, useRef } from 'react';
import ThumbnailPicker from '../components/ThumbnailPicker';

type Section = 'A' | 'B' | 'C' | 'D';

function CharCounter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={`text-xs ${over ? 'text-accent-red' : 'text-text-muted'}`}>
      {value.length}/{max}
    </span>
  );
}

export default function CreatePage() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoInfo, setVideoInfo] = useState<{ name: string; size: string; duration: string } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [thumbnailBytes, setThumbnailBytes] = useState<Uint8Array | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priceInput, setPriceInput] = useState('');

  const pricePlanck = priceInput ? BigInt(Math.round(parseFloat(priceInput) * 1e10)) : 0n;

  const section: Section =
    !videoFile ? 'A'
    : !thumbnailBytes ? 'B'
    : title.length < 1 || description.length < 1 || !priceInput || parseFloat(priceInput) <= 0 ? 'C'
    : 'D';

  function handleFilePick(file: File) {
    setVideoError(null);
    setThumbnailBytes(null);

    const offscreen = document.createElement('video') as HTMLVideoElement;
    offscreen.muted = true;
    const url = URL.createObjectURL(file);
    offscreen.src = url;
    offscreen.onloadedmetadata = () => {
      const mins = Math.floor(offscreen.duration / 60);
      const secs = Math.floor(offscreen.duration % 60);
      setVideoInfo({
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(1)} MiB`,
        duration: `${mins}:${secs.toString().padStart(2, '0')}`,
      });
      URL.revokeObjectURL(url);
      setVideoFile(file);
    };
    offscreen.onerror = () => {
      setVideoError("Can't read this file; try another.");
      URL.revokeObjectURL(url);
    };
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFilePick(file);
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-text-primary mb-6">Create listing</h1>

      {/* Section A: Video picker */}
      <div className="mb-6">
        {!videoFile ? (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            className="border-2 border-dashed border-white/20 rounded-xl p-8 text-center cursor-pointer hover:border-polka-500/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <p className="text-text-secondary text-sm mb-2">Drag & drop a video, or</p>
            <button className="text-polka-400 hover:text-polka-300 text-sm underline">
              Choose file
            </button>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFilePick(f); }}
            />
          </div>
        ) : (
          <div className="rounded-xl bg-surface-900 border border-white/[0.06] p-4 flex flex-col gap-2">
            <p className="text-sm text-text-primary font-medium">{videoInfo?.name}</p>
            <p className="text-xs text-text-muted">{videoInfo?.size} · {videoInfo?.duration}</p>
            <video
              src={URL.createObjectURL(videoFile)}
              controls
              className="w-full rounded-lg mt-1"
              style={{ maxHeight: 200 }}
            />
            <button
              onClick={() => { setVideoFile(null); setVideoInfo(null); setThumbnailBytes(null); }}
              className="text-xs text-text-muted hover:text-text-secondary self-start"
            >
              ✕ Remove
            </button>
          </div>
        )}
        {videoError && <p className="text-accent-red text-xs mt-2">{videoError}</p>}
      </div>

      {/* Section B: Thumbnail picker */}
      {videoFile && (
        <div className="mb-6">
          <ThumbnailPicker videoFile={videoFile} onSelect={(bytes) => setThumbnailBytes(bytes)} />
        </div>
      )}

      {/* Section C: Metadata */}
      {videoFile && thumbnailBytes && (
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-text-secondary">Title</label>
              <CharCounter value={title} max={128} />
            </div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={128}
              placeholder="Give your listing a title"
              className="w-full rounded-lg bg-surface-900 border border-white/10 px-3 py-2 text-sm
                         text-text-primary placeholder:text-text-muted focus:outline-none focus:border-polka-500/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-sm text-text-secondary">Description</label>
              <CharCounter value={description} max={2048} />
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2048}
              rows={4}
              placeholder="Describe your content"
              className="w-full rounded-lg bg-surface-900 border border-white/10 px-3 py-2 text-sm
                         text-text-primary placeholder:text-text-muted focus:outline-none focus:border-polka-500/50 resize-y"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm text-text-secondary">Price (DOT)</label>
            <input
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              type="number"
              min="0.0000000001"
              step="0.01"
              placeholder="e.g. 2.5"
              className="w-full rounded-lg bg-surface-900 border border-white/10 px-3 py-2 text-sm
                         text-text-primary placeholder:text-text-muted focus:outline-none focus:border-polka-500/50"
            />
            {pricePlanck > 0n && (
              <p className="text-xs text-text-muted">{String(pricePlanck)} planck</p>
            )}
          </div>
        </div>
      )}

      {/* Section D placeholder (implemented in Task 11) */}
      {section === 'D' && (
        <button
          data-testid="submit-btn"
          className="w-full py-2.5 rounded-lg bg-polka-500 hover:bg-polka-400 text-white text-sm font-semibold"
        >
          Create listing
        </button>
      )}
    </div>
  );
}
