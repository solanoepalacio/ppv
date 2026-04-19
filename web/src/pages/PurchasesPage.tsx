import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useChainStore } from '../store/chainStore';
import { fetchPurchases, fetchListing, type Listing } from '../hooks/useContentRegistry';
import ListingCard from '../components/ListingCard';
import SkeletonCard from '../components/SkeletonCard';

export default function PurchasesPage() {
  const account = useChainStore((s) => s.account);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) {
      setListings([]);
      return;
    }

    fetchPurchases(account)
      .then(async (purchases) => {
        const resolved = await Promise.all(purchases.map((p) => fetchListing(p.listingId)));
        setListings(resolved.filter((l): l is Listing => l !== undefined));
      })
      .catch((e) => setError(String(e)));
  }, [account]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-text-primary">My Purchases</h1>
        {listings !== null && (
          <span className="text-sm text-text-muted">{listings.length} purchased</span>
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
          <p className="text-text-secondary">You haven't bought anything yet.</p>
          <Link to="/" className="text-polka-400 hover:text-polka-300 text-sm">
            Browse listings
          </Link>
        </div>
      )}

      {listings !== null && listings.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {listings.map((l) => <ListingCard key={String(l.id)} listing={l} />)}
        </div>
      )}
    </div>
  );
}
