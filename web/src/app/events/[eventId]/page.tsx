"use client";

import Link from "next/link";
import { use } from "react";
import useSWR from "swr";
import type { EventDetail, SettlementPackage } from "@/lib/types";
import { isOrganizerDetail } from "@/lib/types";
import { CountdownChip } from "@/components/CountdownChip";
import { EventHero } from "@/components/EventHero";
import { OrganizerPanel } from "@/components/organizer/OrganizerPanel";
import { RsvpCard } from "@/components/attendee/RsvpCard";
import { ArrowLeft } from "lucide-react";

// /events/[eventId] — THE page, Luma-style. Shared hero (cover · title · host ·
// detail tiles · about); attendees get a sticky Registration card in the right
// column, organizers get the manage panels full-width below. 2s polling.
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
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="h-64 animate-pulse rounded-3xl border border-line bg-surface" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
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
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
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

      {organizer ? (
        <div className="flex flex-col gap-8">
          <EventHero ev={ev} meta={data.meta} />
          <OrganizerPanel
            detail={data}
            settlement={settlement}
            onMutate={() => void mutate()}
          />
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
          <EventHero ev={ev} meta={data.meta} />
          <div className="lg:sticky lg:top-20">
            <RsvpCard
              detail={data}
              settlement={settlement}
              onMutate={() => void mutate()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
