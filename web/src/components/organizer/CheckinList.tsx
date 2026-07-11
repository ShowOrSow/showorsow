"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { OrganizerRsvpRow, Persona } from "@/lib/types";
import { PERSONA_COLOR, personaInitial } from "@/lib/persona";
import { useToast } from "../ToastProvider";

// CheckinList (08 §4, latching): one row per STAKED attendee with a latching
// "Check in" button — ONE-WAY, no un-check (the ledger choice is one-way by
// design; a repeat POST is a no-op). Disabled once ended.
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
  // Track in-flight per persona; the latched state comes from row.checkedIn.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // Optimistic latch — once clicked it never un-latches locally either.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});

  // Only staked attendees (and those already settled/checked-in) appear here.
  const staked = rows.filter(
    (r) => r.status === "staked" || r.checkedIn || r.status === "settled",
  );

  async function checkIn(label: string) {
    if (disabled || pending[label]) return;
    setPending((p) => ({ ...p, [label]: true }));
    setOptimistic((o) => ({ ...o, [label]: true }));
    try {
      await api.checkin(eventId, label as Persona);
      onMutate();
    } catch (err) {
      // roll back optimistic latch on hard failure
      setOptimistic((o) => ({ ...o, [label]: false }));
      pushError(err, "Check-in failed");
    } finally {
      setPending((p) => ({ ...p, [label]: false }));
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Check-in</h3>
        <span className="text-xs text-muted">at the venue · one-way</span>
      </div>

      {staked.length === 0 ? (
        <p className="text-sm text-muted">
          No staked attendees yet. Only staked RSVPs can be checked in.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {staked.map((r) => {
            const latched = r.checkedIn || optimistic[r.attendeeLabel];
            return (
              <li
                key={r.attendeeLabel}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-ink"
                    style={{
                      backgroundColor:
                        PERSONA_COLOR[r.attendeeLabel as Persona] ??
                        "var(--color-faint)",
                    }}
                    aria-hidden
                  >
                    {personaInitial(r.attendeeLabel as Persona)}
                  </span>
                  <span className="text-sm">{r.attendeeLabel}</span>
                </span>

                {latched ? (
                  <span className="flex items-center gap-1.5 rounded-lg border border-refund/50 bg-refund/10 px-3 py-1.5 text-sm font-medium text-refund">
                    ✓ Checked in
                  </span>
                ) : (
                  <button
                    onClick={() => checkIn(r.attendeeLabel)}
                    disabled={disabled || pending[r.attendeeLabel]}
                    className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
                  >
                    {pending[r.attendeeLabel] ? "Checking in…" : "Check in"}
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
