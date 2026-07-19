"use client";

import { formatAmount } from "@/lib/api";

// LockCard (08 §2 staked): "🔒 stake locked until settlement — refunded when you
// check in." + Cancel RSVP (pre-deadline only).
export function LockCard({
  stakeAmount,
  tokenLabel,
  canCancel,
  busy,
  onCancel,
}: {
  stakeAmount: string;
  tokenLabel: string;
  canCancel: boolean;
  busy: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gold/40 bg-gold/5 p-5">
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          🔒
        </span>
        <div>
          <p className="text-sm text-text">
            <span className="mono font-semibold text-gold">
              {formatAmount(stakeAmount)} {tokenLabel}
            </span>{" "}
            locked until settlement.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Refunded when you check in at the venue. If you no-show, it funds the
            people who came.
          </p>
        </div>
      </div>

      <div className="border-t border-gold/20 pt-3">
        {canCancel ? (
          <button
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg border border-line px-4 py-2 text-sm text-muted-foreground hover:text-text disabled:opacity-50"
          >
            Cancel RSVP
          </button>
        ) : (
          <p className="text-xs text-faint">
            RSVP deadline passed — stake is committed until settlement.
          </p>
        )}
      </div>
    </div>
  );
}
