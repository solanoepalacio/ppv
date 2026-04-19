import { useNavigate } from 'react-router-dom';
import type { Listing } from '../hooks/useContentRegistry';

interface Props {
  listing: Listing;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function formatDot(planck: bigint): string {
  return `${(Number(planck) / 1e10).toFixed(2)} DOT`;
}

export default function ListingCard({ listing }: Props) {
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
        <p className="text-xs text-text-muted font-mono">{truncateAddress(listing.creator)}</p>
        <p className="text-xs text-polka-300 font-semibold text-right mt-0.5">
          {formatDot(listing.price)}
        </p>
      </div>
    </div>
  );
}
