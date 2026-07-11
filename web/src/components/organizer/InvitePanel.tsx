"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { PERSONAS, type OrganizerRsvpRow, type Persona } from "@/lib/types";
import { PERSONA_COLOR, personaInitial } from "@/lib/persona";
import { RsvpStatusChip } from "../StatusChip";
import { useToast } from "../ToastProvider";

// InvitePanel (08 §2 organizer): persona picker → POST .../invites; rows with
// chips covering all seven rsvp_status values.
export function InvitePanel({
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
  const [busy, setBusy] = useState(false);

  // Attendee personas already on a row can't be re-invited from the picker.
  const invitedLabels = useMemo(
    () => new Set(rows.map((r) => r.attendeeLabel)),
    [rows],
  );
  const invitable = PERSONAS.filter(
    (p) => p !== "Organizer" && !invitedLabels.has(p),
  );
  const [pick, setPick] = useState<Persona | "">("");

  async function invite() {
    if (!pick || busy) return;
    setBusy(true);
    try {
      await api.invite(eventId, pick);
      setPick("");
      onMutate();
    } catch (err) {
      pushError(err, "Invite failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Invitees</h3>
        <span className="text-xs text-muted">
          {rows.length} {rows.length === 1 ? "person" : "people"}
        </span>
      </div>

      {!disabled && (
        <div className="flex items-center gap-2">
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value as Persona)}
            className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-gold"
            disabled={invitable.length === 0}
          >
            <option value="">
              {invitable.length === 0 ? "Everyone invited" : "Select persona…"}
            </option>
            {invitable.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            onClick={invite}
            disabled={!pick || busy}
            className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
          >
            Invite
          </button>
        </div>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {rows.length === 0 && (
          <li className="py-3 text-sm text-muted">No invites yet.</li>
        )}
        {rows.map((r) => (
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
              {r.checkedIn && (
                <span className="text-xs text-refund">checked in</span>
              )}
            </span>
            <RsvpStatusChip status={r.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
