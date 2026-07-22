"use client";

import type { EventCore, OrganizerStats } from "@/lib/types";
import { formatAmount } from "@/lib/api";
import { tokenLabelOf } from "@/lib/format";
import { TokenLogo } from "./TokenLogo";
import { Lock, ShieldCheck } from "lucide-react";

// VaultCard — the escrow, made visible. Stakes are NOT held by this app: each
// one is a CIP-56 Allocation locked registry-side until settleBefore, so the
// vault is a *view* over the token registry, not a balance we custody. Showing
// the instrument's own logo here is the point — when an event runs on cBTC or
// cETH, the vault reads in that token end to end (bounty requirement: the token
// must drive state, not just appear in a label).
export function VaultCard({
  ev,
  stats,
}: {
  ev: EventCore;
  stats: OrganizerStats;
}) {
  const token = tokenLabelOf(ev);
  const settled = ev.status === "settled";
  const locked = settled ? "0" : stats.tvl;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-accent/40 px-5 py-4">
        <div className="flex items-center gap-3">
          <TokenLogo label={token} size={40} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-faint">
              Event vault
            </p>
            <p className="font-medium text-text">
              {token} escrow{" "}
              <span className="text-muted-foreground">· registry-locked</span>
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-refund" />
          CIP-56 Allocation
        </span>
      </div>

      <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
        <VaultStat
          label="Locked"
          value={formatAmount(locked)}
          token={token}
          icon
          accent
        />
        <VaultStat
          label="Pot balance"
          value={formatAmount(stats.potBalance)}
          token={token}
        />
        <VaultStat label="Stakes held" value={String(stats.headcount)} />
        <VaultStat
          label="Checked in"
          value={`${stats.checkedInCount}/${stats.headcount}`}
        />
      </div>

      <p className="border-t border-line px-5 py-3 text-xs leading-relaxed text-faint">
        {settled
          ? `Settled — every ${token} allocation was released on-ledger: refunds via Allocation_Cancel, slashes via Allocation_ExecuteTransfer.`
          : `Each stake is a ${token} holding locked by the registry until settlement. ShowOrSow never takes custody — if the app disappears, attendees recover their funds when the allocation expires.`}
      </p>
    </div>
  );
}

function VaultStat({
  label,
  value,
  token,
  icon,
  accent,
}: {
  label: string;
  value: string;
  token?: string;
  icon?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="px-5 py-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon && <Lock className="size-3" />}
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span
          className={`mono text-xl font-semibold tabular-nums ${accent ? "text-refund" : "text-text"}`}
        >
          {value}
        </span>
        {token && (
          <span className="text-sm text-muted-foreground">{token}</span>
        )}
      </p>
    </div>
  );
}
