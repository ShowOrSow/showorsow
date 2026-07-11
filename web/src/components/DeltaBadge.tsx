import { formatAmount } from "@/lib/api";

// DeltaBadge (08 §4): balance delta = after − before from balance_snapshots.
// Green for positive (refund/share), red for negative (slash).
export function DeltaBadge({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  // NOTE: computes the delta via JS float subtraction (see formatAmount's
  // render-precision limit). Exact at the demo's 0.01-CBTC scale; for tokens
  // with >8 decimals this could show float artifacts — display-only.
  const b = Number(before);
  const a = Number(after);
  const delta = a - b;
  const positive = delta >= 0;
  const sign = positive ? "+" : "−";
  const mag = Math.abs(delta);

  return (
    <span
      className={`mono inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${
        positive
          ? "border-refund/50 text-refund"
          : "border-slash/50 text-slash"
      }`}
      title={`before ${formatAmount(before)} → after ${formatAmount(after)}`}
    >
      {sign}
      {formatAmount(mag)}
    </span>
  );
}
