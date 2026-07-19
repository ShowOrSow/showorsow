"use client";

import type { BalanceDelta } from "@/lib/types";
import { DeltaBadge } from "../DeltaBadge";

// SettledCard (08 §2 settled): outcome card — ✅ refunded (+share) or ❌ slashed,
// with balance delta.
export function SettledCard({
  checkedIn,
  delta,
  tokenLabel,
}: {
  checkedIn: boolean;
  delta?: BalanceDelta;
  tokenLabel: string;
}) {
  const refunded = checkedIn;

  return (
    <div
      className={`flex flex-col gap-4 rounded-xl border p-5 ${
        refunded ? "border-refund/40 bg-refund/5" : "border-slash/40 bg-slash/5"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden>
          {refunded ? "✅" : "❌"}
        </span>
        <div>
          <p className="text-sm font-semibold text-text">
            {refunded ? "Refunded" : "Slashed"}
          </p>
          <p className="text-xs text-muted-foreground">
            {refunded
              ? "You checked in — stake returned, plus your share of the pot."
              : "You didn't check in — your stake was redistributed to attendees who showed."}
          </p>
        </div>
      </div>

      {delta && (
        <div className="flex items-center gap-2 border-t border-line pt-3 text-sm">
          <span className="text-muted-foreground">Balance delta</span>
          <DeltaBadge before={delta.before} after={delta.after} />
          <span className="text-muted-foreground">{tokenLabel}</span>
        </div>
      )}
    </div>
  );
}
