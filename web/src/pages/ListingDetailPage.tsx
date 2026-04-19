import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import {
  fetchListing,
  hasPurchased,
  submitPurchase,
  type Listing,
} from '../hooks/useContentRegistry';
import VideoPlayer from '../components/VideoPlayer';

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatDot(planck: bigint): string {
  return `${(Number(planck) / 1e10).toFixed(2)} DOT`;
}

type PageState = 'loading' | 'not-found' | 'unpurchased' | 'purchased';

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const account = useChainStore((s: any) => s.account);
  const balance = useChainStore((s: any) => s.balance);

  const [listing, setListing] = useState<Listing | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [buyStatus, setBuyStatus] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) { setPageState('not-found'); return; }
    const listingId = BigInt(id);

    fetchListing(listingId)
      .then(async (l) => {
        if (!l) { setPageState('not-found'); return; }
        setListing(l);
        const isCreator = account === l.creator;
        if (isCreator) { setPageState('purchased'); return; }
        if (!account) { setPageState('unpurchased'); return; }
        const purchased = await hasPurchased(account, listingId);
        setPageState(purchased ? 'purchased' : 'unpurchased');
      })
      .catch(() => setPageState('not-found'));
  }, [id, account]);

  if (pageState === 'loading') {
    return (
      <div className="animate-pulse flex flex-col gap-4">
        <div className="h-4 w-24 rounded bg-white/[0.06]" />
        <div className="w-full aspect-video rounded-xl bg-surface-800" />
      </div>
    );
  }

  if (pageState === 'not-found' || !listing) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-text-secondary">Listing not found.</p>
        <Link to="/" className="text-polka-400 hover:text-polka-300 text-sm">← Browse</Link>
      </div>
    );
  }

  const isCreator = account === listing.creator;
  const canAfford = balance >= listing.price;

  async function handleBuy() {
    if (!listing) return;
    setBuyError(null);
    setBuyStatus('Waiting for signature…');
    try {
      await submitPurchase(listing.id);
      setBuyStatus(null);
      setPageState('purchased');
    } catch (e) {
      setBuyStatus(null);
      setBuyError(String(e));
    }
  }

  function handleCopyAddress() {
    navigator.clipboard.writeText(listing!.creator);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <Link to="/" className="text-sm text-text-muted hover:text-text-primary mb-4 inline-block">
        ← Browse
      </Link>

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1">
          {pageState === 'purchased' ? (
            <VideoPlayer contentCid={listing.contentCid} contentHash={listing.contentHash} />
          ) : (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-surface-800">
              <img src={listing.thumbnailUrl} alt={listing.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                <span className="text-white/70 text-sm font-medium tracking-wide uppercase">🔒 Preview</span>
              </div>
            </div>
          )}
        </div>

        <div className="lg:w-72 flex flex-col gap-4">
          <h1 className="text-xl font-semibold text-text-primary">{listing.title}</h1>

          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted font-mono">{truncateAddress(listing.creator)}</span>
            <button onClick={handleCopyAddress} className="text-xs text-polka-400 hover:text-polka-300">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          <p className="text-lg font-semibold text-polka-300">{formatDot(listing.price)}</p>

          {pageState === 'purchased' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-accent-green font-medium">✓ Purchased</span>
              {isCreator && (
                <span className="text-xs text-text-muted border border-white/10 rounded px-2 py-0.5">
                  Your listing
                </span>
              )}
            </div>
          )}

          {pageState === 'unpurchased' && !isCreator && (
            <div className="flex flex-col gap-2">
              <button
                onClick={handleBuy}
                disabled={!canAfford || !!buyStatus}
                className="w-full py-2.5 rounded-lg bg-polka-500 hover:bg-polka-400 text-white text-sm
                           font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {buyStatus ?? `Buy for ${formatDot(listing.price)}`}
              </button>
              <p className="text-xs text-text-muted">
                Balance: {formatDot(balance)}
              </p>
              {!canAfford && (
                <p className="text-xs text-accent-red">
                  Not enough DOT to purchase this listing.
                </p>
              )}
              {buyError && <p className="text-xs text-accent-red">{buyError}</p>}
            </div>
          )}

          <p className="text-sm text-text-secondary whitespace-pre-wrap">{listing.description}</p>
        </div>
      </div>
    </div>
  );
}
