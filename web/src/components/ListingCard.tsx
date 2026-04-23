import { Link, useNavigate } from 'react-router-dom';
import type { Listing } from '../hooks/useContentRegistry';
import { formatDot, truncateAddress } from '../utils/format';

interface Stats {
  purchaseCount: number;
}

interface Props {
  listing: Listing;
  isPurchased?: boolean;
  isOwn?: boolean;
  stats?: Stats;
}

export default function ListingCard({ listing, isPurchased, isOwn, stats }: Props) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/listing/${listing.id}`)}
      className="rounded-xl overflow-hidden bg-surface-900 border border-white/[0.06] cursor-pointer
                 transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-glow"
    >
      <div className="w-full aspect-video bg-surface-800 overflow-hidden">
        <img
          src={listing.thumbnailUrl}
          alt={listing.title}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      </div>

      <div className="p-3 flex flex-col gap-1">
        <p className="text-sm font-medium text-text-primary line-clamp-2">{listing.title}</p>
        <p className="text-xs text-text-muted font-mono">
          By:{' '}
          <Link
            to={`/creator/${listing.creator}`}
            onClick={(e) => e.stopPropagation()}
            className="text-white hover:underline cursor-pointer"
          >
            {truncateAddress(listing.creator)}
          </Link>
        </p>
        <p
          className={`text-xs font-semibold text-right mt-0.5 ${
            isOwn ? 'text-text-muted' : isPurchased ? 'text-accent-green' : 'text-polka-300'
          }`}
        >
          {isOwn ? 'By you' : isPurchased ? 'Purchased' : formatDot(listing.price)}
        </p>
        {stats && (
          <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs">
            <span className="text-text-secondary">
              {stats.purchaseCount} {stats.purchaseCount === 1 ? 'sale' : 'sales'}
            </span>
            <span className="text-accent-green font-mono">
              {`${formatDot(listing.price * BigInt(stats.purchaseCount))} earned`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
