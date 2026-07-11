"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { OrganizerRsvpRow } from "@/lib/types";
import { avatarColor, avatarInitial } from "@/lib/identity";
import { RsvpStatusChip } from "../StatusChip";
import { useToast } from "../ToastProvider";

// InvitePanel (08 §2 organizer): email input → POST .../invites (invitee must
// have an account — 404 renders "no account with that email — ask them to sign
// up"). Rows show invitee name/email with chips covering all seven rsvp_status
// values. Plus a Copy event link button (shareable URL, Luma-style).
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
  const { pushError, push } = useToast();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const target = email.trim();
    if (!target || busy) return;
    setBusy(true);
    try {
      await api.invite(eventId, target);
      setEmail("");
      onMutate();
    } catch (err) {
      // 404 {stage:'user'} → the invitee has no account yet (05 §2).
      if (err instanceof ApiError && err.status === 404) {
        push({
          kind: "error",
          message:
            err.detail ||
            "No account with that email — ask them to sign up.",
          stage: err.stage,
          errorId: err.errorId,
        });
      } else {
        pushError(err, "Invite failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/events/${encodeURIComponent(eventId)}`
        : "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      push({ kind: "success", message: "Event link copied to clipboard." });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      push({ kind: "error", message: "Couldn't copy — copy it manually." });
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Invitees</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">
            {rows.length} {rows.length === 1 ? "person" : "people"}
          </span>
          <button
            type="button"
            onClick={copyLink}
            className="rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-faint hover:text-text"
          >
            {copied ? "Copied ✓" : "Copy event link"}
          </button>
        </div>
      </div>

      {!disabled && (
        <form onSubmit={invite} className="flex items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="invitee@example.com"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-gold"
          />
          <button
            type="submit"
            disabled={!email.trim() || busy}
            className="shrink-0 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-sm font-medium text-gold hover:bg-gold/20 disabled:opacity-50"
          >
            {busy ? "Inviting…" : "Invite"}
          </button>
        </form>
      )}

      <ul className="flex flex-col divide-y divide-line">
        {rows.length === 0 && (
          <li className="py-3 text-sm text-muted">No invites yet.</li>
        )}
        {rows.map((r) => {
          const display = r.attendeeName || r.attendeeEmail || r.attendeeParty;
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
                <span className="min-w-0">
                  <span className="block truncate text-sm text-text">
                    {display}
                  </span>
                  {r.attendeeEmail && r.attendeeName && (
                    <span className="block truncate text-xs text-muted">
                      {r.attendeeEmail}
                    </span>
                  )}
                </span>
                {r.checkedIn && (
                  <span className="shrink-0 text-xs text-refund">checked in</span>
                )}
              </span>
              <RsvpStatusChip status={r.status} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
