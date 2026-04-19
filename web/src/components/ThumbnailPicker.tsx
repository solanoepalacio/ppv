import { useEffect, useState } from 'react';

interface Props {
  videoFile: File;
  onSelect: (thumbnailBytes: Uint8Array) => void;
}

function extractFrame(
  videoEl: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timeSeconds: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    videoEl.currentTime = timeSeconds;
    videoEl.onseeked = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No canvas context')); return; }
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
      }, 'image/jpeg', 0.85);
    };
    videoEl.onerror = reject;
  });
}

export default function ThumbnailPicker({ videoFile, onSelect }: Props) {
  const [frames, setFrames] = useState<{ url: string; bytes: Uint8Array }[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const url = URL.createObjectURL(videoFile);
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    video.src = url;
    video.muted = true;
    video.preload = 'metadata';

    video.onloadedmetadata = async () => {
      const dur = video.duration;
      const times = [dur * 0.2, dur * 0.5, dur * 0.8]
        .map((t) => Math.min(Math.max(t, 0), dur - 0.1));

      const extracted: { url: string; bytes: Uint8Array }[] = [];
      for (const t of times) {
        try {
          const bytes = await extractFrame(video, canvas, t);
          extracted.push({ url: URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })), bytes });
        } catch {
          // skip frames that fail
        }
      }
      setFrames(extracted);
      setLoading(false);
    };

    return () => {
      URL.revokeObjectURL(url);
      frames.forEach((f) => URL.revokeObjectURL(f.url));
    };
  }, [videoFile]);

  function handleSelect(index: number) {
    setSelected(index);
    onSelect(frames[index].bytes);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-text-muted text-sm">
        <div className="w-4 h-4 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
        Extracting thumbnail candidates…
      </div>
    );
  }

  if (frames.length === 0) {
    return <p className="text-accent-red text-sm">Couldn't extract frames from this file.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">Pick a thumbnail.</p>
      <div className="grid grid-cols-3 gap-3">
        {frames.map((f, i) => (
          <button
            key={i}
            onClick={() => handleSelect(i)}
            className={`rounded-lg overflow-hidden border-2 transition-all ${
              selected === i
                ? 'border-polka-500 shadow-glow'
                : 'border-transparent hover:border-white/20'
            }`}
          >
            <img src={f.url} alt={`Frame ${i + 1}`} className="w-full aspect-video object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
