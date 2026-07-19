"use client";

import Link from "next/link";
import useSWR from "swr";
import type { EventListRow } from "@/lib/types";
import { EventCard } from "@/components/EventCard";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

// /events — Event list (08 §2). Cards from GET /api/events (user-scoped: events
// you organize + events you were invited to). Post-pivot any signed-in user can
// create an event (organizer = whoever created it — 05 §2).
export default function EventsPage() {
  const { data, isLoading, error } = useSWR<EventListRow[]>("/api/events");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Events you organize or were invited to — mirrors ledger visibility.
          </p>
        </div>
        <Button asChild className="gap-1.5 rounded-full">
          <Link href="/events/new">
            <Plus className="size-4" />
            Create event
          </Link>
        </Button>
      </div>

      {isLoading && <SkeletonGrid />}

      {error && (
        <div className="rounded-xl border border-slash/40 bg-surface p-6 text-sm text-slash">
          Could not load events. Is the backend reachable?
        </div>
      )}

      {data && data.length === 0 && (
        <div className="rounded-xl border border-line bg-surface p-10 text-center">
          <p className="text-muted-foreground">
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
