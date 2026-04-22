import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import {
  fetchListingsByCreator,
  type ListingWithStats,
} from '../hooks/useContentRegistry';
import ListingCard from '../components/ListingCard';
import SkeletonCard from '../components/SkeletonCard';

export default function MyListingsPage() {
  const account = useChainStore((s) => s.account);
  const [listings, setListings] = useState<ListingWithStats[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) {
      setListings(null);
      return;
    }
    setError(null);
    setListings(null);
    fetchListingsByCreator(account)
      .then(setListings)
      .catch((e) => setError(String(e)));
  }, [account]);

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <h1 className="text-xl font-semibold text-text-primary">My Listings</h1>
        <p className="text-text-secondary">Connect your wallet to see your listings.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">My Listings</h1>
        {listings !== null && (
          <span className="text-sm text-text-muted">
            {listings.length} listing{listings.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && <p className="text-accent-red text-sm">{error}</p>}

      {listings === null && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {listings !== null && listings.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-text-secondary">You haven't published anything yet.</p>
          <Link to="/upload" className="text-polka-400 hover:text-polka-300 text-sm">
            Create your first listing
          </Link>
        </div>
      )}

      {listings !== null && listings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((l) => (
            <ListingCard
              key={String(l.id)}
              listing={l}
              isOwn
              stats={{ purchaseCount: l.purchaseCount }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
