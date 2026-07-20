"use client";

import Link from "next/link";
import type { EventListRow } from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { EventStatusChip, RsvpStatusChip } from "./StatusChip";
import { CountdownChip } from "./CountdownChip";
import { MapPin, Users, ArrowUpRight, Coins } from "lucide-react";

// EventCard (08 §4): title, token badge, stake, RSVP-deadline countdown, status
// chip, headcount (organizer only). Role is per-event now (no global persona):
// a row carrying `headcount` is one this user organizes.
export function EventCard({ row }: { row: EventListRow }) {
  const ev = row.event;
  const organizer = row.headcount !== undefined;

  return (
    <Link
      href={`/events/${encodeURIComponent(ev.eventId)}`}
      className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 transition-all hover:-translate-y-0.5 hover:border-refund/40 hover:shadow-[0_10px_30px_-18px_rgba(5,150,105,0.35)]"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug text-text">{ev.title}</h3>
        <EventStatusChip status={ev.status} />
      </div>

      {ev.venue && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-3.5 shrink-0" />
          {ev.venue}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs">
          <Coins className="size-3.5 text-refund" />
          <span className="mono font-semibold text-refund">
            {formatAmount(ev.stakeAmount)}
          </span>
          <span className="text-muted-foreground">{ev.tokenLabel}</span>
        </span>
        <CountdownChip deadline={ev.rsvpDeadline} />
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line pt-3 text-xs">
        {organizer ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="size-3.5" />
            <span className="mono font-semibold text-text">
              {row.headcount ?? 0}
            </span>
            attending
          </span>
        ) : row.myStatus ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            your RSVP <RsvpStatusChip status={row.myStatus} />
          </span>
        ) : (
          <span className="text-faint">invited</span>
        )}
        <span className="flex items-center gap-0.5 text-faint transition-colors group-hover:text-refund">
          open
          <ArrowUpRight className="size-3.5" />
        </span>
      </div>
    </Link>
  );
}
