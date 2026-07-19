"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { Balance } from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { useReceiveSheet } from "./ReceiveSheet";

// BalancePill (08 §1): the logged-in user's per-token balance from
// GET /api/balances (live Holdings, not DB). Flashes green/red after settlement.
export function BalancePill() {
  const { user, isAuthenticated } = useSession();
  const { openReceive } = useReceiveSheet();
  const { data } = useSWR<Balance[]>(
    isAuthenticated ? "/api/balances" : null,
    { refreshInterval: 4000 },
  );
  const [flash, setFlash] = useState<"" | "flash-green" | "flash-red">("");
  const prevTotals = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!data) return;
    let anyUp = false;
    let anyDown = false;
    for (const b of data) {
      const cur = Number(b.amount);
      const prev = prevTotals.current[b.instrumentId];
      if (prev !== undefined && cur !== prev) {
        if (cur > prev) anyUp = true;
        else anyDown = true;
      }
      prevTotals.current[b.instrumentId] = cur;
    }
    if (anyUp || anyDown) {
      setFlash(anyUp ? "flash-green" : "flash-red");
      const t = setTimeout(() => setFlash(""), 1300);
      return () => clearTimeout(t);
    }
  }, [data]);

  // Reset baseline when the account changes so a login switch doesn't false-flash.
  useEffect(() => {
    prevTotals.current = {};
    setFlash("");
  }, [user?.partyId]);

  // Data still loading / transient fetch error → neutral placeholder, NOT an
  // empty wallet (a mid-demo backend hiccup must not read as "no holdings").
  // Clicking the pill opens the Receive sheet (deposit address + faucet) — 08 §1.
  const pillBase =
    "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-faint";

  if (!data) {
    return (
      <button type="button" onClick={openReceive} title="Receive tokens" className={`${pillBase} text-muted-foreground`}>
        <span className="mono text-faint">—</span>
      </button>
    );
  }

  // Confirmed empty array = genuinely no holdings.
  if (data.length === 0) {
    return (
      <button type="button" onClick={openReceive} title="Receive tokens" className={`${pillBase} text-muted-foreground`}>
        <span className="mono">no holdings</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openReceive}
      title="Receive tokens"
      className={`flex items-center gap-3 ${pillBase} ${flash}`}
    >
      {data.map((b) => (
        <span key={b.instrumentId} className="flex items-center gap-1.5">
          <span className="mono font-semibold text-gold">{formatAmount(b.amount)}</span>
          <span className="text-muted-foreground">{instrumentShort(b.instrumentId)}</span>
        </span>
      ))}
    </button>
  );
}

function instrumentShort(instrumentId: string): string {
  // instrumentId may be "admin::CBTC" or similar — show the trailing token label.
  const parts = instrumentId.split(/[:/]/).filter(Boolean);
  return parts[parts.length - 1] || instrumentId;
}
