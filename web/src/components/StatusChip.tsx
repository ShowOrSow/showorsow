import type { EventStatus, RsvpStatus } from "@/lib/types";

// StatusChip — covers all SEVEN rsvp statuses (08 §4) plus event statuses.
// Color semantics: gold=stake/escrow, refund=green, slash=red, info=blue.
const RSVP_STYLE: Record<RsvpStatus, { label: string; cls: string }> = {
  invited: { label: "invited", cls: "border-info/50 text-info" },
  accepted: { label: "accepted", cls: "border-gold/50 text-gold" },
  declined: { label: "declined", cls: "border-faint/60 text-muted" },
  staked: { label: "staked", cls: "border-gold/60 text-gold bg-gold/5" },
  withdrawn: { label: "withdrawn", cls: "border-slash/50 text-slash" },
  cancelled: { label: "cancelled", cls: "border-faint/60 text-muted" },
  settled: { label: "settled", cls: "border-refund/50 text-refund" },
};

const EVENT_STYLE: Record<EventStatus, { label: string; cls: string }> = {
  open: { label: "open", cls: "border-refund/50 text-refund" },
  ended: { label: "ended", cls: "border-info/50 text-info" },
  settled: { label: "settled", cls: "border-info/50 text-info" },
};

export function RsvpStatusChip({ status }: { status: RsvpStatus }) {
  const s = RSVP_STYLE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

export function EventStatusChip({ status }: { status: EventStatus }) {
  const s = EVENT_STYLE[status];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
