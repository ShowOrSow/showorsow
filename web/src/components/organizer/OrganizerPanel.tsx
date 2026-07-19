"use client";

import { useState } from "react";
import type {
  OrganizerEventDetail,
  SettlementPackage,
} from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { InvitePanel } from "./InvitePanel";
import { CheckinList } from "./CheckinList";
import { SettleButton } from "./SettleButton";
import { SettlementResults } from "../SettlementResults";

// Organizer "Check-in & Settle" (08 §2, beats 5–6). Stat row · invite panel ·
// check-in list · close & settle · settlement results.
export function OrganizerPanel({
  detail,
  settlement,
  onMutate,
}: {
  detail: OrganizerEventDetail;
  settlement?: SettlementPackage;
  onMutate: () => void;
}) {
  const ev = detail.event;
  const stats = detail.stats;
  const isSettled = ev.status === "settled";
  const isEnded = ev.status === "ended" || isSettled;

  // Locally captured settlement package from the close POST (before the indexer
  // catches up); falls back to the fetched one.
  const [justSettled, setJustSettled] = useState<SettlementPackage | undefined>(
    undefined,
  );
  const results = justSettled ?? settlement;

  return (
    <div className="flex flex-col gap-5">
      {/* Stat row — headcount counts STAKED (privacy beat: reads 3 before check-in). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Headcount" value={String(stats.headcount)} hint="staked" />
        <Stat label="Checked in" value={String(stats.checkedInCount)} />
        <Stat label="TVL" value={formatAmount(stats.tvl)} unit={ev.tokenLabel} />
        <Stat
          label="Pot balance"
          value={formatAmount(stats.potBalance)}
          unit={ev.tokenLabel}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <InvitePanel
          eventId={ev.eventId}
          rows={detail.rsvps}
          disabled={isEnded}
          onMutate={onMutate}
        />
        <CheckinList
          eventId={ev.eventId}
          rows={detail.rsvps}
          disabled={isEnded}
          onMutate={onMutate}
        />
      </div>

      {results ? (
        <SettlementResults pkg={results} />
      ) : (
        <SettleButton
          eventId={ev.eventId}
          disabled={isSettled}
          onSettled={(pkg) => {
            setJustSettled(pkg);
            onMutate();
          }}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-muted-foreground">
        {label}
        {hint && <span className="text-faint"> · {hint}</span>}
      </p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="mono text-xl font-semibold text-text">{value}</span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </p>
    </div>
  );
}
