"use client";

import Link from "next/link";
import { use } from "react";
import useSWR from "swr";
import type { EventDetail, SettlementPackage } from "@/lib/types";
import { SettlementResults } from "@/components/SettlementResults";

// /events/[eventId]/results — SettlementResults (08 §2). Same data as the
// embedded panel; a standalone view for the demo's results beat.
export default function ResultsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const enc = encodeURIComponent(eventId);

  const { data: detail } = useSWR<EventDetail>(`/api/events/${enc}`, {
    refreshInterval: 2000,
  });
  const { data, error, isLoading } = useSWR<SettlementPackage>(
    `/api/events/${enc}/settlement`,
    { refreshInterval: 2000 },
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href={`/events/${enc}`}
          className="text-sm text-muted hover:text-text"
        >
          ← Event
        </Link>
        <h1 className="mt-2 text-xl font-semibold">
          {detail?.event.title ?? "Settlement"} · Results
        </h1>
        <p className="text-sm text-muted">
          Refunds, slashes, and pot redistribution — settled on-ledger.
        </p>
      </div>

      {isLoading && (
        <div className="h-48 animate-pulse rounded-xl border border-line bg-surface" />
      )}

      {error && (
        <div className="rounded-xl border border-slash/40 bg-surface p-6 text-sm text-slash">
          No settlement yet, or it couldn&apos;t be loaded.
        </div>
      )}

      {data && <SettlementResults pkg={data} />}
    </div>
  );
}
