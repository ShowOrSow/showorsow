"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type { Balance } from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { useReceiveSheet } from "./ReceiveSheet";
import { TokenLogo } from "./TokenLogo";

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
  // The token *label* only earns its ~34px per token once the row is genuinely
  // wide, so it waits for lg. Between sm and lg the desktop nav is already back
  // in row 1, and with labels on there is no room left: the amounts (the only
  // shrinkable node) collapsed to zero width and the tickers painted over the
  // account button. Amounts never shrink now — the pill keeps its intrinsic
  // width and the account name truncates instead.
  const pillBase =
    "shrink-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm hover:border-faint sm:px-3";

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
      className={`flex items-center gap-2 ${pillBase} lg:gap-3 ${flash}`}
    >
      {data.map((b) => (
        <span key={b.instrumentId} className="flex items-center gap-1 lg:gap-1.5">
          <TokenLogo label={instrumentShort(b.instrumentId)} size={16} />
          <span className="mono shrink-0 font-semibold text-gold tabular-nums">
            {formatAmount(b.amount)}
          </span>
          <span className="hidden text-muted-foreground lg:inline">
            {instrumentShort(b.instrumentId)}
          </span>
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
