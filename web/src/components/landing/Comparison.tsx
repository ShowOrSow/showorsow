import { Check, X, Minus, ArrowLeftRight } from "lucide-react";

// Comparison — ShowOrSow vs the two things organizers actually use today:
// a free RSVP tool (Luma/Eventbrite-style) and paid ticketing. Framed by what
// the ORGANIZER feels, not by feature checkboxes. The honest column matters:
// paid tickets DO fix no-shows — they just cost the attendee real money and
// make casual community events feel transactional.
const ROWS: {
  label: string;
  free: "no" | "yes" | "partial";
  paid: "no" | "yes" | "partial";
  sos: "no" | "yes" | "partial";
  freeNote?: string;
  paidNote?: string;
  sosNote?: string;
}[] = [
  {
    label: "Free for attendees who show up",
    free: "yes",
    paid: "no",
    sos: "yes",
    paidNote: "ticket is spent",
    sosNote: "stake refunded",
  },
  {
    label: "No-shows have a real cost",
    free: "no",
    paid: "yes",
    sos: "yes",
    freeNote: "zero friction to ghost",
  },
  {
    label: "Headcount you can plan on",
    free: "no",
    paid: "yes",
    sos: "yes",
  },
  {
    label: "No-show money returns to attendees",
    free: "no",
    paid: "no",
    sos: "yes",
    paidNote: "organizer keeps it",
    sosNote: "pot splits to those who came",
  },
  {
    label: "Guest list stays private",
    free: "partial",
    paid: "partial",
    sos: "yes",
    freeNote: "platform sees all",
    paidNote: "platform + processor",
    sosNote: "enforced by the ledger",
  },
  {
    label: "Settlement without manual refunds",
    free: "no",
    paid: "partial",
    sos: "yes",
    paidNote: "refund policies, support tickets",
    sosNote: "one atomic transaction",
  },
];

export function Comparison() {
  return (
    <div className="relative">
      {/* The table needs 46rem, so on a phone it scrolls. Without a cue that
          reads as scrollable, the ShowOrSow column — the whole point — sits
          off-screen unnoticed. Hint + edge fade, mobile only. */}
      <p className="mb-2 flex items-center gap-1.5 text-xs text-faint sm:hidden">
        <ArrowLeftRight className="size-3.5" />
        Swipe the table to compare
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="w-[38%] px-4 pb-3 text-left font-medium text-muted-foreground">
              What the organizer gets
            </th>
            <Th>Free RSVP tools</Th>
            <Th>Paid ticketing</Th>
            <Th highlight>ShowOrSow</Th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => (
            <tr key={r.label}>
              <td
                className={`border-t border-line px-4 py-3 text-text ${i === 0 ? "" : ""}`}
              >
                {r.label}
              </td>
              <Td state={r.free} note={r.freeNote} />
              <Td state={r.paid} note={r.paidNote} />
              <Td state={r.sos} note={r.sosNote} highlight />
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-ink to-transparent sm:hidden"
      />
    </div>
  );
}

function Th({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <th
      className={`w-[20%] px-4 pb-3 text-center font-semibold ${
        highlight ? "text-refund" : "text-muted-foreground"
      }`}
    >
      {children}
    </th>
  );
}

function Td({
  state,
  note,
  highlight,
}: {
  state: "yes" | "no" | "partial";
  note?: string;
  highlight?: boolean;
}) {
  const icon =
    state === "yes" ? (
      <Check className="size-4 text-refund" />
    ) : state === "no" ? (
      <X className="size-4 text-slash" />
    ) : (
      <Minus className="size-4 text-faint" />
    );
  return (
    <td
      className={`border-t border-line px-4 py-3 text-center align-middle ${
        highlight ? "bg-accent/40" : ""
      }`}
    >
      <span className="inline-flex flex-col items-center gap-0.5">
        {icon}
        {note && <span className="text-[11px] leading-tight text-faint">{note}</span>}
      </span>
    </td>
  );
}
