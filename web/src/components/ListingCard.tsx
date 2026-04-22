import { useNavigate } from 'react-router-dom';
import type { Listing } from '../hooks/useContentRegistry';
import { formatDot, truncateAddress } from '../utils/format';

interface Props {
  listing: Listing;
  isPurchased?: boolean;
  isOwn?: boolean;
}

export default function ListingCard({ listing, isPurchased, isOwn }: Props) {
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
        <p className="text-xs text-text-muted font-mono">By: {truncateAddress(listing.creator)}</p>
        <p
          className={`text-xs font-semibold text-right mt-0.5 ${
            isOwn ? 'text-text-muted' : isPurchased ? 'text-accent-green' : 'text-polka-300'
          }`}
        >
          {isOwn ? 'By you' : isPurchased ? 'Purchased' : formatDot(listing.price)}
        </p>
      </div>
    </div>
  );
}
