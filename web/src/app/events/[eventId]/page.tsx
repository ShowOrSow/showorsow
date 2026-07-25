"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import useSWR from "swr";
import type { EventDetail, SettlementPackage } from "@/lib/types";
import { isOrganizerDetail } from "@/lib/types";
import { ApiError } from "@/lib/api";
import { CountdownChip } from "@/components/CountdownChip";
import {
  EventCover,
  EventSideMeta,
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

  // Grace window for the "still indexing" state above. Without a ceiling a
  // genuinely missing event would spin forever instead of reporting an error.
  const [settlingTimedOut, setSettlingTimedOut] = useState(false);
  useEffect(() => {
    if (data) return;
    const t = setTimeout(() => setSettlingTimedOut(true), 30_000);
    return () => clearTimeout(t);
  }, [data]);

  const settled = data?.event.status === "settled";
  const { data: settlement } = useSWR<SettlementPackage>(
    settled ? `${key}/settlement` : null,
    { refreshInterval: 2000 },
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {/* Mirrors EventCover's mobile cap so the page does not jump ~100px
            when the real content swaps in. */}
        <div className="grid gap-10 lg:grid-cols-[320px_1fr]">
          <div className="mx-auto aspect-square w-full max-w-[15rem] animate-pulse rounded-2xl border border-line bg-surface lg:max-w-none" />
          <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />
        </div>
      </div>
    );
  }

  // A just-created event 404s until the indexer projects its contract, and the
  // create form redirects here the moment the ledger write returns — so the
  // organizer used to land on "Could not load this event" and have to refresh.
  // SWR is already re-polling every 2s; this only stops the error card from
  // claiming failure while the read model is still catching up. Applies to any
  // entry path (shared links included), not just the redirect, and a fixed
  // delay in the form would not: indexer lag is not a constant.
  if (error && !data) {
    const notFoundYet = error instanceof ApiError && error.status === 404;
    if (notFoundYet && !settlingTimedOut) {
      return (
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-surface px-6 py-16 text-center">
            <span className="size-6 animate-spin rounded-full border-2 border-line border-t-refund" />
            <p className="font-medium text-text">Settling on the ledger…</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              The event is committed. Waiting for the read model to catch up —
              this page will fill in on its own.
            </p>
          </div>
        </div>
      );
    }
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

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />
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

      <div className="flex flex-col gap-7 lg:grid lg:grid-cols-[320px_1fr] lg:items-start lg:gap-10">
        {/* Desktop: a sticky left rail. Mobile: `contents` dissolves this
            wrapper so the cover, the title column and the host/stake rail all
            become items of the outer flex column — letting EventSideMeta's
            order-last put the title and Registration card above it instead of
            a screen below. */}
        <div className="contents lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-5">
          <EventCover ev={ev} meta={data.meta} />
          <EventSideMeta ev={ev} />
        </div>

        <div className="flex min-w-0 flex-col gap-7">
          <EventTitleBlock ev={ev} meta={data.meta} />
          {!organizer && (
            <RsvpCard
              detail={data}
              settlement={settlement}
              onMutate={() => void mutate()}
            />
          )}
          <EventAbout ev={ev} meta={data.meta} />
        </div>
      </div>

      {/* Organizer manage panels get the full width below the header block —
          the invitee + check-in lists are too wide for the right column. */}
      {organizer && (
        <div className="mt-10 border-t border-line pt-8">
          <OrganizerPanel
            detail={data}
            settlement={settlement}
            onMutate={() => void mutate()}
          />
        </div>
      )}
    </div>
  );
}
