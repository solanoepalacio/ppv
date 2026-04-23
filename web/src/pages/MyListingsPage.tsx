import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import {
  fetchListingsByCreator,
  type ListingWithStats,
} from '../hooks/useContentRegistry';
import ListingCard from '../components/ListingCard';
import SkeletonCard from '../components/SkeletonCard';
import { formatDot } from '../utils/format';

export default function MyListingsPage() {
  const { address: paramAddress } = useParams<{ address: string }>();
  const account = useChainStore((s) => s.account);
  const target = paramAddress ?? account;
  const isSelf = !paramAddress || (account !== null && paramAddress === account);

  const [listings, setListings] = useState<ListingWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setListings(null);
      return;
    }
    setError(null);
    setListings(null);
    fetchListingsByCreator(target)
      .then(setListings)
      .catch((e) => setError(String(e)));
  }, [target]);

  const totals = useMemo(() => {
    if (!listings) return null;
    const earnings = listings.reduce(
      (sum, l) => sum + l.price * BigInt(l.purchaseCount),
      0n,
    );
    return { uploads: listings.length, earnings };
  }, [listings]);

  if (!target) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <h1 className="text-xl font-semibold text-text-primary">My Listings</h1>
        <p className="text-text-secondary">Connect your wallet to see your listings.</p>
      </div>
    );
  }

  return (
    <div>
      {isSelf ? (
        <h1 className="text-xl font-semibold text-text-primary mb-2">My Listings</h1>
      ) : (
        <h1 className="text-xl font-semibold text-text-primary mb-2">
          Listings of{' '}
          <span className="font-mono text-white break-all">{target}</span>
        </h1>
      )}

      {totals && (
        <div className="flex items-center gap-6 mb-6 text-sm text-text-secondary">
          <span className="text-text-primary">
            {`${totals.uploads} upload${totals.uploads !== 1 ? 's' : ''}`}
          </span>
          <span className="text-accent-green font-mono">
            {`${formatDot(totals.earnings)} total earnings`}
          </span>
        </div>
      )}

      {error && <p className="text-accent-red text-sm">{error}</p>}

      {listings === null && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {listings !== null && listings.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          {isSelf ? (
            <>
              <p className="text-text-secondary">You haven't published anything yet.</p>
              <Link to="/upload" className="text-polka-400 hover:text-polka-300 text-sm">
                Create your first listing
              </Link>
            </>
          ) : (
            <p className="text-text-secondary">No listings for this creator.</p>
          )}
        </div>
      )}

      {listings !== null && listings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((l) => (
            <ListingCard
              key={String(l.id)}
              listing={l}
              isOwn={isSelf}
              stats={{ purchaseCount: l.purchaseCount }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
