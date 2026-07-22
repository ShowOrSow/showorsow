"use client";

import { useState } from "react";
import type {
  OrganizerEventDetail,
  SettlementPackage,
} from "@/lib/types";
import { InvitePanel } from "./InvitePanel";
import { CheckinList } from "./CheckinList";
import { SettleButton } from "./SettleButton";
import { SettlementResults } from "../SettlementResults";
import { VaultCard } from "../VaultCard";

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
      {/* The vault replaces the old bare stat row: same numbers (headcount counts
          STAKED — privacy beat: reads 3 before check-in) but framed as what they
          actually are, an on-registry escrow denominated in the event's token. */}
      <VaultCard ev={ev} stats={stats} />

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

