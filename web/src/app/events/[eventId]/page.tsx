"use client";

import Link from "next/link";
import { use } from "react";
import useSWR from "swr";
import type { EventDetail, SettlementPackage } from "@/lib/types";
import { isOrganizerDetail } from "@/lib/types";
import { CountdownChip } from "@/components/CountdownChip";
import {
  EventSideCard,
  EventTitleBlock,
  EventAbout,
} from "@/components/EventHero";
import { OrganizerPanel } from "@/components/organizer/OrganizerPanel";
import { RsvpCard } from "@/components/attendee/RsvpCard";
import { ArrowLeft } from "lucide-react";

// /events/[eventId] — Luma anatomy (verified against luma.com): square cover +
// hosted-by in a narrow LEFT rail; big title, date/location tiles, the
// Registration card (attendee) or manage panels (organizer), then About in the
// wide RIGHT column. 2s polling.
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

  const settled = data?.event.status === "settled";
  const { data: settlement } = useSWR<SettlementPackage>(
    settled ? `${key}/settlement` : null,
    { refreshInterval: 2000 },
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[320px_1fr]">
          <div className="aspect-square animate-pulse rounded-2xl border border-line bg-surface" />
          <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-slash/30 bg-surface p-6">
          <p className="text-sm text-slash">Could not load this event.</p>
          <Link href="/events" className="mt-3 inline-block text-sm text-refund">
            ← Back to events
          </Link>
        </div>
      </div>
    );
  }

  const ev = data.event;
  const organizer = isOrganizerDetail(data);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      {/* top bar: back + countdown + results */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/events"
          className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-text"
        >
          <ArrowLeft className="size-4" />
          Events
        </Link>
        <div className="flex items-center gap-2">
          <CountdownChip deadline={ev.rsvpDeadline} />
          {settled && (
            <Link
              href={`/events/${encodeURIComponent(eventId)}/results`}
              className="text-sm font-medium text-refund hover:underline"
            >
              Full results →
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[320px_1fr] lg:items-start">
        <EventSideCard ev={ev} meta={data.meta} />

        <div className="flex min-w-0 flex-col gap-7">
          <EventTitleBlock ev={ev} meta={data.meta} />

          {organizer ? (
            <OrganizerPanel
              detail={data}
              settlement={settlement}
              onMutate={() => void mutate()}
            />
          ) : (
            <RsvpCard
              detail={data}
              settlement={settlement}
              onMutate={() => void mutate()}
            />
          )}

          <EventAbout ev={ev} meta={data.meta} />
        </div>
      </div>
    </div>
  );
}
