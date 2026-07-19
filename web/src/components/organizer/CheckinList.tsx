"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { OrganizerRsvpRow } from "@/lib/types";
import { avatarColor, avatarInitial } from "@/lib/identity";
import { useToast } from "../ToastProvider";

// CheckinList (08 §4, latching): one row per STAKED attendee with a latching
// "Check in" button — ONE-WAY, no un-check (the ledger choice is one-way by
// design; a repeat POST is a no-op). Disabled once ended. Posts {attendeeParty}.
export function CheckinList({
  eventId,
  rows,
  disabled,
  onMutate,
}: {
  eventId: string;
  rows: OrganizerRsvpRow[];
  disabled: boolean;
  onMutate: () => void;
}) {
  const { pushError } = useToast();
  // Track in-flight per party; the latched state comes from row.checkedIn.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // Optimistic latch — once clicked it never un-latches locally either.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  // Only staked attendees (and those already settled/checked-in) appear here.
  const staked = rows.filter(
    (r) => r.status === "staked" || r.checkedIn || r.status === "settled",
  );

  async function checkIn(party: string) {
    if (disabled || pending[party]) return;
    setPending((p) => ({ ...p, [party]: true }));
    setOptimistic((o) => ({ ...o, [party]: true }));
    try {
      await api.checkin(eventId, party);
      onMutate();
    } catch (err) {
      // roll back optimistic latch on hard failure
      setOptimistic((o) => ({ ...o, [party]: false }));
      pushError(err, "Check-in failed");
    } finally {
      setPending((p) => ({ ...p, [party]: false }));
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Check-in</h3>
        <span className="text-xs text-muted-foreground">at the venue · one-way</span>
      </div>

      {staked.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No staked attendees yet. Only staked RSVPs can be checked in.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {staked.map((r) => {
            const latched = r.checkedIn || optimistic[r.attendeeParty];
            const display =
              r.attendeeName || r.attendeeEmail || r.attendeeParty;
            return (
              <li
                key={r.attendeeParty}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-ink"
                    style={{ backgroundColor: avatarColor(r.attendeeParty) }}
                    aria-hidden
                  >
                    {avatarInitial(r.attendeeName, r.attendeeEmail)}
                  </span>
                  <span className="block min-w-0 truncate text-sm">
                    {display}
                  </span>
                </span>

                {latched ? (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-refund/50 bg-refund/10 px-3 py-1.5 text-sm font-medium text-refund">
                    ✓ Checked in
                  </span>
                ) : (
                  <button
                    onClick={() => checkIn(r.attendeeParty)}
                    disabled={disabled || pending[r.attendeeParty]}
                    className="shrink-0 rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
                  >
                    {pending[r.attendeeParty] ? "Checking in…" : "Check in"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {disabled && (
        <p className="text-xs text-faint">Event ended — check-in closed.</p>
      )}
    </div>
  );
}
