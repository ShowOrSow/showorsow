"use client";

import Link from "next/link";
import { use } from "react";
import useSWR from "swr";
import type { EventDetail, SettlementPackage } from "@/lib/types";
import { isOrganizerDetail } from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { EventStatusChip } from "@/components/StatusChip";
import { CountdownChip } from "@/components/CountdownChip";
import { OrganizerPanel } from "@/components/organizer/OrganizerPanel";
import { AttendeePanel } from "@/components/attendee/AttendeePanel";

// /events/[eventId] — THE page, role-adaptive (08 §2). 2s polling during demo.
export default function EventDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const key = `/api/events/${encodeURIComponent(eventId)}`;

  const { data, error, isLoading, mutate } = useSWR<EventDetail>(key, {
    refreshInterval: 2000,
  });

  // Settlement package (embedded results). Only meaningful once settled; polled
  // alongside so a fresh settlement surfaces without a manual reload.
  const settled = data?.event.status === "settled";
  const { data: settlement } = useSWR<SettlementPackage>(
    settled ? `${key}/settlement` : null,
    { refreshInterval: 2000 },
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-slash/30 bg-surface p-6">
          <p className="text-sm text-slash">Could not load this event.</p>
          <Link href="/events" className="mt-3 inline-block text-sm text-gold">
            ← Back to events
          </Link>
        </div>
      </div>
    );
  }

  const ev = data.event;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <Link href="/events" className="text-sm text-muted-foreground hover:text-text">
          ← Events
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{ev.title}</h1>
            {ev.venue && <p className="text-sm text-muted-foreground">{ev.venue}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EventStatusChip status={ev.status} />
            <CountdownChip deadline={ev.rsvpDeadline} />
          </div>
        </div>
        {ev.description && (
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{ev.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span className="text-muted-foreground">
            Stake{" "}
            <span className="mono font-semibold text-gold">
              {formatAmount(ev.stakeAmount)} {ev.tokenLabel}
            </span>
          </span>
          <span className="text-muted-foreground">
            Ends{" "}
            <span className="text-text">{formatDateTime(ev.eventEnd)}</span>
          </span>
          {settled && (
            <Link
              href={`/events/${encodeURIComponent(eventId)}/results`}
              className="text-gold hover:underline"
            >
              View full results →
            </Link>
          )}
        </div>
      </div>

      {isOrganizerDetail(data) ? (
        <OrganizerPanel
          detail={data}
          settlement={settlement}
          onMutate={() => void mutate()}
        />
      ) : (
        <AttendeePanel
          detail={data}
          settlement={settlement}
          onMutate={() => void mutate()}
        />
      )}
    </div>
  );
}
