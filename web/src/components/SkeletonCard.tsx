export default function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden bg-surface-900 border border-white/[0.06] animate-pulse">
      <div className="w-full aspect-video bg-white/[0.06]" />
      <div className="p-3 flex flex-col gap-2">
        <div className="h-4 w-3/4 rounded bg-white/[0.06]" />
        <div className="h-3 w-1/2 rounded bg-white/[0.04]" />
        <div className="h-3 w-1/4 rounded bg-white/[0.04] self-end" />
      </div>
    </div>
  );
}
