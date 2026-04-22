import { useEffect, useState } from 'react';
import { fetchFromIpfs } from '../hooks/useBulletinUpload';
import { verifyContentHash } from '../utils/contentHash';
import { fetchWrappedKey, watchWrappedKey, type BulletinCidFields } from '../hooks/useContentRegistry';
import { decryptContent } from '../utils/contentCipher';
import { openSealed } from '../utils/sealedBox';

type State =
  | 'loading'
  | 'awaiting-key'
  | 'decrypting'
  | 'verified'
  | 'integrity-failed'
  | 'decrypt-failed'
  | 'error';

interface Props {
  contentCid: BulletinCidFields;
  contentHash: Uint8Array;
  listingId: bigint;
  currentAccount: string;
  viewerPublicKey: Uint8Array;
  viewerPrivateKey: Uint8Array;
  plaintextKey?: Uint8Array; // creator fast-path — supplied by CreatePage session
}

export default function VideoPlayer({
  contentCid,
  contentHash,
  listingId,
  currentAccount,
  viewerPublicKey,
  viewerPrivateKey,
  plaintextKey,
}: Props) {
  const [state, setState] = useState<State>('loading');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;

    async function runDecryption(clk: Uint8Array) {
      if (cancelled) return;
      setState('decrypting');
      try {
        const ciphertext = await fetchFromIpfs(contentCid);
        if (cancelled) return;
        let plaintext: Uint8Array;
        try {
          plaintext = await decryptContent(ciphertext, clk);
        } catch {
          if (!cancelled) setState('decrypt-failed');
          return;
        }
        if (cancelled) return;
        if (!verifyContentHash(plaintext, contentHash)) {
          setState('integrity-failed');
          return;
        }
        const blob = new Blob([plaintext], { type: 'video/mp4' });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setState('verified');
      } catch {
        if (!cancelled) setState('error');
      }
    }

    setState('loading');
    setBlobUrl(null);

    // Creator fast-path: skip chain round-trip entirely.
    if (plaintextKey) {
      void runDecryption(plaintextKey);
      return () => {
        cancelled = true;
        if (url) URL.revokeObjectURL(url);
      };
    }

    setState('awaiting-key');

    let unwrapped = false;
    const handleSealed = (sealed: Uint8Array) => {
      if (unwrapped || cancelled) return;
      unwrapped = true;
      openSealed(viewerPublicKey, viewerPrivateKey, sealed)
        .then((clk) => runDecryption(clk))
        .catch(() => {
          if (!cancelled) setState('decrypt-failed');
        });
    };

    // Past purchases: the sealed key is already in storage. Fetch once.
    // Fresh purchases: fetch returns null; the subscription picks it up when
    // the content-unlock-service writes it.
    const sub = watchWrappedKey(currentAccount, listingId, (sealed) => {
      if (!sealed) return;
      handleSealed(sealed);
    });

    fetchWrappedKey(currentAccount, listingId)
      .then((sealed) => {
        if (sealed) handleSealed(sealed);
      })
      .catch(() => {
        // Non-fatal: the subscription may still deliver the key.
      });

    return () => {
      cancelled = true;
      sub.unsubscribe();
      if (url) URL.revokeObjectURL(url);
    };
  }, [contentCid, contentHash, listingId, currentAccount, viewerPublicKey, viewerPrivateKey, plaintextKey, retryKey]);

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

  if (state === 'decrypt-failed') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex items-center justify-center">
        <p className="text-accent-red text-sm">⚠ Decryption failed — wrong key or tampered content</p>
      </div>
    );
  }

  if (state === 'awaiting-key') {
    return (
      <div className="w-full aspect-video bg-surface-800 rounded-xl flex flex-col items-center justify-center gap-3 animate-pulse">
        <div className="w-8 h-8 rounded-full border-2 border-polka-500 border-t-transparent animate-spin" />
        <p className="text-text-secondary text-xs">Waiting for content unlock…</p>
      </div>
    );
  }

  if (state !== 'verified' || !blobUrl) {
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
