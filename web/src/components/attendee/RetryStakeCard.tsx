"use client";

// RetryStakeCard (08 §2 accepted): partial-failure recovery. "RSVP accepted,
// stake not locked yet" + Retry stake → POST /api/rsvps/{rsvpCid}/stake.
export function RetryStakeCard({
  busy,
  rsvpCid,
  onRetry,
}: {
  busy: boolean;
  rsvpCid?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gold/40 bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="text-xl" aria-hidden>
          ⚠️
        </span>
        <div>
          <p className="text-sm font-medium text-text">
            RSVP accepted, stake not locked yet.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The allocation step didn't complete. Your seat isn't held until the
            stake locks — retry to finish.
          </p>
        </div>
      </div>
      <div>
        <button
          disabled={busy || !rsvpCid}
          onClick={onRetry}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-ink hover:brightness-95 disabled:opacity-50"
        >
          Retry stake
        </button>
      </div>
    </div>
  );
}
