import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllListings, fetchPurchases, type Listing } from '../hooks/useContentRegistry';
import { useChainStore } from '../store/chainStore';
import ListingCard from '../components/ListingCard';
import SkeletonCard from '../components/SkeletonCard';

export default function BrowsePage() {
  const account = useChainStore((s: any) => s.account);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllListings()
      .then(setListings)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!account) {
      setPurchasedIds(new Set());
      return;
    }
    fetchPurchases(account)
      .then((rows) => setPurchasedIds(new Set(rows.map((r) => String(r.listingId)))))
      .catch(() => {});
  }, [account]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Browse</h1>
        {listings !== null && (
          <span className="text-sm text-text-muted">
            {listings.length} listing{listings.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <p className="text-accent-red text-sm">{error}</p>
      )}

      {listings === null && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {listings !== null && listings.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <p className="text-text-secondary">No listings yet.</p>
          <Link to="/create" className="text-polka-400 hover:text-polka-300 text-sm">
            Create the first listing
          </Link>
        </div>
      )}

      {listings !== null && listings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((l) => (
            <ListingCard key={String(l.id)} listing={l} isPurchased={purchasedIds.has(String(l.id))} />
          ))}
        </div>
      )}
    </div>
  );
}
