"use client";

import Link from "next/link";
import useSWR from "swr";
import type { EventListRow } from "@/lib/types";
import { EventCard } from "@/components/EventCard";

// /events — Event list (08 §2). Cards from GET /api/events (user-scoped: events
// you organize + events you were invited to). Post-pivot any signed-in user can
// create an event (organizer = whoever created it — 05 §2).
export default function EventsPage() {
  const { data, isLoading, error } = useSWR<EventListRow[]>("/api/events");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Events</h1>
          <p className="text-sm text-muted">
            Events you organize or were invited to — mirrors ledger visibility.
          </p>
        </div>
        <Link
          href="/events/new"
          className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-ink hover:brightness-95"
        >
          + Create Event
        </Link>
      </div>

      {isLoading && <SkeletonGrid />}

      {error && (
        <div className="rounded-xl border border-slash/40 bg-surface p-6 text-sm text-slash">
          Could not load events. Is the backend reachable?
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-xl border border-line bg-surface p-10 text-center">
          <p className="text-muted">
            Nothing here yet — create an event, or wait for an invitation.
          </p>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {data.map((row) => (
            <EventCard key={row.event.eventId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-40 animate-pulse rounded-xl border border-line bg-surface"
        />
      ))}
    </div>
  );
}
