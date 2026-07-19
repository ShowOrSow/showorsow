"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Token } from "@/lib/types";
import { toIsoFromLocalInput } from "@/lib/format";
import { TokenSelect } from "./TokenSelect";
import { useToast } from "./ToastProvider";

// EventForm (08 §4 / §2 /events/new): title · description · venue · token ·
// stake amount · RSVP deadline · event end. Submit → POST /api/events →
// {eventId} → redirect /events/[eventId]. Backend derives settleBefore.
export function EventForm() {
  const router = useRouter();
  const { pushError } = useToast();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
  const [tokenLabel, setTokenLabel] = useState("");
  const [token, setToken] = useState<Token | undefined>(undefined);
  const [stakeAmount, setStakeAmount] = useState("");
  const [rsvpDeadline, setRsvpDeadline] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const valid =
    title.trim() &&
    tokenLabel &&
    stakeAmount.trim() &&
    Number(stakeAmount) > 0 &&
    rsvpDeadline &&
    eventEnd;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const { eventId } = await api.createEvent({
        title: title.trim(),
        description: description.trim(),
        venue: venue.trim(),
        stakeAmount: stakeAmount.trim(),
        tokenLabel,
        rsvpDeadline: toIsoFromLocalInput(rsvpDeadline),
        eventEnd: toIsoFromLocalInput(eventEnd),
      });
      router.push(`/events/${encodeURIComponent(eventId)}`);
    } catch (err) {
      pushError(err, "Could not create event");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="Title" required>
        <input
          className={inputCls}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Canton Meetup #12"
          required
        />
      </Field>

      <Field label="Description">
        <textarea
          className={`${inputCls} min-h-20 resize-y`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's the event about?"
        />
      </Field>

      <Field label="Venue">
        <input
          className={inputCls}
          value={venue}
          onChange={(e) => setVenue(e.target.value)}
          placeholder="HackCanton HQ, Berlin"
        />
      </Field>

      <TokenSelect
        value={tokenLabel}
        onChange={(label, t) => {
          setTokenLabel(label);
          setToken(t);
        }}
      />

      <Field label="Stake amount" required>
        <div className="flex items-center gap-2">
          <input
            className={`${inputCls} mono`}
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.01"
            required
          />
          {token && (
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              {token.label} · {token.decimals} dp
            </span>
          )}
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="RSVP deadline" required>
          <input
            type="datetime-local"
            className={inputCls}
            value={rsvpDeadline}
            onChange={(e) => setRsvpDeadline(e.target.value)}
            required
          />
        </Field>
        <Field label="Event end" required>
          <input
            type="datetime-local"
            className={inputCls}
            value={eventEnd}
            onChange={(e) => setEventEnd(e.target.value)}
            required
          />
        </Field>
      </div>
      <p className="-mt-2 text-xs text-faint">
        The backend derives the on-ledger settle deadline from event end + buffer.
      </p>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={!valid || submitting}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create Event"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/events")}
          className="rounded-lg border border-line px-4 py-2 text-sm text-muted-foreground hover:text-text"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-gold";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm text-muted-foreground">
        {label}
        {required && <span className="text-gold"> *</span>}
      </label>
      {children}
    </div>
  );
}
