"use client";

import { useSession } from "./SessionProvider";

// StaleBadge (08 §1): shows "data syncing…" when indexerLagMs > 10s (from
// GET /api/session — backend proxies indexer healthz).
const THRESHOLD_MS = 10_000;

export function StaleBadge() {
  const { session } = useSession();
  const lag = session?.indexerLagMs ?? 0;
  if (lag <= THRESHOLD_MS) return null;

  return (
    <div
      className="flex items-center gap-1.5 rounded-lg border border-info/50 bg-surface px-2.5 py-1 text-xs text-info"
      title={`indexer lag ${(lag / 1000).toFixed(1)}s`}
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
      data syncing…
    </div>
  );
}
