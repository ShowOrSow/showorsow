"use client";

import Link from "next/link";
import type { EventListRow } from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { EventStatusChip, RsvpStatusChip } from "./StatusChip";
import { CountdownChip } from "./CountdownChip";

// EventCard (08 §4): title, token badge, stake, RSVP-deadline countdown, status
// chip, headcount (organizer only). Role is per-event now (no global persona):
// a row carrying `headcount` is one this user organizes.
export function EventCard({ row }: { row: EventListRow }) {
  const ev = row.event;
  const organizer = row.headcount !== undefined;

  return (
    <Link
      href={`/events/${encodeURIComponent(ev.eventId)}`}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-faint"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug text-text group-hover:text-gold">
          {ev.title}
        </h3>
        <EventStatusChip status={ev.status} />
      </div>

      {ev.venue && <p className="text-sm text-muted">{ev.venue}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/5 px-2 py-0.5 text-xs">
          <span className="mono font-semibold text-gold">
            {formatAmount(ev.stakeAmount)}
          </span>
          <span className="text-muted">{ev.tokenLabel}</span>
        </span>
        <CountdownChip deadline={ev.rsvpDeadline} />
      </div>

      <div className="mt-1 flex items-center justify-between border-t border-line pt-3 text-xs">
        {organizer ? (
          <span className="text-muted">
            headcount{" "}
            <span className="mono font-semibold text-text">
              {row.headcount ?? 0}
            </span>
          </span>
        ) : row.myStatus ? (
          <span className="flex items-center gap-1.5 text-muted">
            your RSVP <RsvpStatusChip status={row.myStatus} />
          </span>
        ) : (
          <span className="text-faint">invited</span>
        )}
        <span className="text-faint group-hover:text-gold">open →</span>
      </div>
    </Link>
  );
}
