export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export function formatDot(planck: bigint): string {
  const dot = Number(planck) / 1e12;
  return `${dot.toFixed(2)} DOT`;
}

/// Format a PAPI dispatch error into a human-readable string.
export function formatDispatchError(err: unknown): string {
	if (!err) return "Transaction failed";
	const e = err as { type?: string; value?: { type?: string; value?: { type?: string } } };
	if (e.type === "Module" && e.value) {
		const mod = e.value;
		return `${mod.type}.${mod.value?.type ?? ""}`.replace(/:?\s*$/, "");
	}
	return JSON.stringify(err);
}
