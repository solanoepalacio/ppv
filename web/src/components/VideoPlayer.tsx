import { useEffect, useState } from 'react';
import { fetchFromIpfs } from '../hooks/useBulletinUpload';
import { verifyContentHash } from '../utils/contentHash';
import type { BulletinCidFields } from '../hooks/useContentRegistry';

type State = 'loading' | 'verified' | 'integrity-failed' | 'error';

interface Props {
  contentCid: BulletinCidFields;
  contentHash: Uint8Array;
}

export default function VideoPlayer({ contentCid, contentHash }: Props) {
  const [state, setState] = useState<State>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    setState('loading');
    setBlobUrl(null);

    fetchFromIpfs(contentCid)
      .then((bytes) => {
        if (cancelled) return;
        if (!verifyContentHash(bytes, contentHash)) {
          setState('integrity-failed');
          return;
        }
        const blob = new Blob([bytes], { type: 'video/mp4' });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setState('verified');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [contentCid, contentHash, retryKey]);

  if (state === 'error') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex flex-col items-center justify-center gap-3">
        <p className="text-text-secondary text-sm">Couldn't reach content storage.</p>
        <button
          onClick={() => setRetryKey((k) => k + 1)}
          className="text-polka-400 hover:text-polka-300 text-sm underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (state === 'integrity-failed') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center">
        <p className="text-accent-red text-sm">⚠ Content failed integrity check</p>
      </div>
    );
  }

  if (state === 'loading' || !blobUrl) {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center animate-pulse">
        <div className="w-8 h-8 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-1.5">
      <video controls src={blobUrl} className="w-full rounded-xl bg-black" />
      <p className="text-xs text-accent-green flex items-center gap-1">
        <span>✓</span> Content verified
      </p>
    </div>
  );
}
