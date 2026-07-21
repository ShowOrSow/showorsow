"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import type { EventListRow } from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { tokenLabelOf } from "@/lib/format";
import { EventStatusChip, RsvpStatusChip } from "@/components/StatusChip";
import { coverFor, hostLabel } from "@/components/EventHero";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MapPin, Plus, Ticket, Users } from "lucide-react";

// /events — Luma-style timeline: Upcoming / Past tabs, rows grouped by event
// date with a time rail on the left and a card (title · host · venue · chips ·
// cover thumb) on the right. Data: GET /api/events (user-scoped).
export default function EventsPage() {
  const { data, isLoading, error } = useSWR<EventListRow[]>("/api/events");
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const groups = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const isPast = (r: EventListRow) =>
      r.event.status === "settled" ||
      new Date(r.event.eventEnd).getTime() < now;
    const rows = data.filter((r) => (tab === "past" ? isPast(r) : !isPast(r)));
    rows.sort((a, b) => {
      const ta = new Date(a.event.eventEnd).getTime();
      const tb = new Date(b.event.eventEnd).getTime();
      return tab === "past" ? tb - ta : ta - tb;
    });
    const byDay = new Map<string, EventListRow[]>();
    for (const r of rows) {
      const d = new Date(r.event.eventEnd);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, [...(byDay.get(key) ?? []), r]);
    }
    return [...byDay.entries()];
  }, [data, tab]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
        <div className="flex items-center gap-2">
          <Tabs tab={tab} onTab={setTab} />
          <Button asChild className="gap-1.5 rounded-full">
            <Link href="/events/new">
              <Plus className="size-4" />
              Create event
            </Link>
          </Button>
        </div>
      </div>

      {isLoading && <SkeletonList />}

      {error && (
        <div className="rounded-2xl border border-slash/30 bg-surface p-6 text-sm text-slash">
          Could not load events. Is the backend reachable?
        </div>
      )}

      {data && groups.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line bg-surface px-6 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-refund">
            <Ticket className="size-6" />
          </span>
          <p className="font-medium text-text">
            {tab === "upcoming" ? "No upcoming events" : "No past events"}
          </p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {tab === "upcoming"
              ? "Create an event, or wait for an invitation — events appear here the moment you're invited."
              : "Settled and finished events will show up here."}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-8">
        {groups.map(([day, rows]) => (
          <section key={day} className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            <DayLabel iso={day} />
            <div className="flex flex-col gap-3">
              {rows.map((row) => (
                <TimelineCard key={row.event.eventId} row={row} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Tabs({
  tab,
  onTab,
}: {
  tab: "upcoming" | "past";
  onTab: (t: "upcoming" | "past") => void;
}) {
  return (
    <div className="flex rounded-full border border-line bg-surface p-0.5 text-sm">
      {(["upcoming", "past"] as const).map((t) => (
        <button
          key={t}
          onClick={() => onTab(t)}
          className={cn(
            "rounded-full px-3.5 py-1.5 capitalize transition-colors",
            tab === t
              ? "bg-secondary font-medium text-text"
              : "text-muted-foreground hover:text-text",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function DayLabel({ iso }: { iso: string }) {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return (
    <div className="pt-1 sm:text-right">
      <p className="font-semibold text-text">{day}</p>
      <p className="text-sm text-faint">{weekday}</p>
    </div>
  );
}

function TimelineCard({ row }: { row: EventListRow }) {
  const ev = row.event;
  const organizer = row.headcount !== undefined;
  const host = organizer ? "You" : hostLabel(ev.organizerParty);
  const time = new Date(ev.eventEnd).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Link
      href={`/events/${encodeURIComponent(ev.eventId)}`}
      className="group flex gap-4 rounded-2xl border border-line bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-refund/40 hover:shadow-[0_10px_30px_-18px_rgba(5,150,105,0.35)]"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">{time}</p>
        <h3 className="truncate font-semibold text-text">{ev.title}</h3>
        {host && (
          <p className="text-sm text-muted-foreground">
            Hosted by <span className="text-text">{host}</span>
          </p>
        )}
        {ev.venue && (
          <p className="flex items-center gap-1.5 truncate text-sm text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            {ev.venue}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-xs">
            <span className="mono font-semibold text-refund">
              {formatAmount(ev.stakeAmount)}
            </span>
            <span className="text-muted-foreground">{tokenLabelOf(ev)} stake</span>
          </span>
          <EventStatusChip status={ev.status} />
          {organizer ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Users className="size-3.5" />
              {row.headcount ?? 0} attending
            </span>
          ) : (
            row.myStatus && <RsvpStatusChip status={row.myStatus} />
          )}
        </div>
      </div>
      <div
        className={cn(
          "hidden size-24 shrink-0 self-center overflow-hidden rounded-xl bg-gradient-to-br sm:block",
          coverFor(ev.eventId),
        )}
      >
        <Ticket className="m-auto mt-8 size-7 rotate-12 text-white/50" />
      </div>
    </Link>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-32 animate-pulse rounded-2xl border border-line bg-surface"
        />
      ))}
    </div>
  );
}
