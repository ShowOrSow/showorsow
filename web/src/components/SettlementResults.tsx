"use client";

import type {
  BalanceDelta,
  SettlementPackage,
  SettlementRow,
} from "@/lib/types";
import { formatAmount, truncatePartyId } from "@/lib/api";
import { DeltaBadge } from "./DeltaBadge";

// SettlementResults (08 §2 /results, also embedded in detail): per-attendee row
// → outcome chip, payout amount + status, and balance delta = after − before
// from balance_snapshots. Ghost row highlighted. Footer per row: tx update_id.
export function SettlementResults({ pkg }: { pkg: SettlementPackage }) {
  // The settlements array is the canonical row set; payouts are matched in.
  const rows = pkg.settlements.length ? pkg.settlements : pkg.payouts;
  const deltaByParty = indexDeltas(pkg.deltas);

  const refunds = rows.filter((r) => r.outcome === "refunded").length;
  const slashes = rows.filter((r) => r.outcome === "slashed").length;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Settlement results</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-refund">{refunds} refunded</span>
          <span className="text-slash">{slashes} slashed</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">
          No payout rows — either nobody checked in or nothing was slashed (pot
          keeps funds).
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-medium">Attendee</th>
                <th className="pb-2 font-medium">Outcome</th>
                <th className="pb-2 font-medium">Payout</th>
                <th className="pb-2 font-medium">Delta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <ResultRow
                  key={`${r.attendeeLabel}-${i}`}
                  row={r}
                  delta={deltaByParty[r.attendeeLabel]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ResultRow({
  row,
  delta,
}: {
  row: SettlementRow;
  delta?: BalanceDelta;
}) {
  const ghost = row.isGhost || (row.outcome === "slashed" && !row.checkedIn);
  return (
    <>
      <tr
        className={`border-t border-line align-top ${
          ghost ? "bg-slash/5" : ""
        }`}
      >
        <td className="py-2.5">
          <span className="flex items-center gap-2">
            {row.attendeeLabel}
            {ghost && (
              <span className="rounded border border-slash/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slash">
                ghost
              </span>
            )}
          </span>
        </td>
        <td className="py-2.5">
          {row.outcome === "refunded" ? (
            <span className="text-refund">✅ refunded</span>
          ) : (
            <span className="text-slash">❌ slashed</span>
          )}
        </td>
        <td className="py-2.5">
          {row.payoutAmount ? (
            <span className="flex items-center gap-1.5">
              <span className="mono">{formatAmount(row.payoutAmount)}</span>
              {row.payoutStatus && (
                <span
                  className={`text-xs ${
                    row.payoutStatus === "accepted"
                      ? "text-refund"
                      : "text-muted"
                  }`}
                >
                  {row.payoutStatus}
                </span>
              )}
            </span>
          ) : (
            <span className="text-faint">—</span>
          )}
        </td>
        <td className="py-2.5">
          {delta ? (
            <DeltaBadge before={delta.before} after={delta.after} />
          ) : (
            <span className="text-faint">—</span>
          )}
        </td>
      </tr>
      {row.txId && (
        <tr className={ghost ? "bg-slash/5" : ""}>
          <td colSpan={4} className="pb-2.5">
            <span className="mono text-[11px] text-faint">
              settled on-ledger, tx {truncatePartyId(row.txId, 12, 8)}
            </span>
          </td>
        </tr>
      )}
    </>
  );
}

function indexDeltas(deltas: BalanceDelta[]): Record<string, BalanceDelta> {
  const out: Record<string, BalanceDelta> = {};
  for (const d of deltas) out[d.party] = d;
  return out;
}
