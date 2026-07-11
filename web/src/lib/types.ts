// Response shapes mirroring 05-backend.md §2. These are the frontend's contract
// with the Go backend — the ONLY thing the browser talks to (never the ledger).

export type Persona = "Organizer" | "Alice" | "Bob" | "Charlie";
export const PERSONAS: Persona[] = ["Organizer", "Alice", "Bob", "Charlie"];

// All SEVEN rsvp_status values (04/07 + 08 §2).
export type RsvpStatus =
  | "invited"
  | "accepted"
  | "declined"
  | "staked"
  | "withdrawn"
  | "cancelled"
  | "settled";

export const RSVP_STATUSES: RsvpStatus[] = [
  "invited",
  "accepted",
  "declined",
  "staked",
  "withdrawn",
  "cancelled",
  "settled",
];

export type EventStatus = "open" | "ended" | "settled";

// GET /api/session
export interface SessionInfo {
  persona: Persona;
  partyId: string;
  indexerLagMs: number;
}

// POST /api/session
export interface SessionPost {
  persona: Persona;
  partyId: string;
}

// GET /api/tokens — configured tokens + live decimals from registry metadata
export interface Token {
  label: string;
  instrumentId: string;
  decimals: number;
  adminParty?: string;
}

// GET /api/balances — live Holding interface query for current persona
export interface Balance {
  instrumentId: string;
  amount: string; // string to preserve precision; mono/tabular-nums render
}

// Shared event fields (read model — 07-database.md `events` + `event_meta`).
export interface EventCore {
  eventId: string;
  title: string;
  description?: string;
  venue?: string;
  tokenLabel: string;
  instrumentId?: string;
  decimals?: number;
  stakeAmount: string;
  rsvpDeadline: string; // ISO
  eventEnd: string; // ISO
  settleBefore?: string; // ISO — backend-derived
  status: EventStatus;
  contractId?: string;
}

// event_meta split (05 §8) — but backend returns them merged as {event, meta}.
export interface EventMeta {
  description?: string;
  venue?: string;
  imageUrl?: string;
}

// GET /api/events — persona-scoped list rows
export interface EventListRow {
  event: EventCore;
  meta?: EventMeta;
  // organizer-only headcount; attendee gets their own status
  headcount?: number;
  myStatus?: RsvpStatus;
}

// Organizer detail rsvp row
export interface OrganizerRsvpRow {
  attendeeLabel: string;
  status: RsvpStatus;
  checkedIn: boolean;
  rsvpCid?: string;
}

export interface OrganizerStats {
  headcount: number; // counts STAKED (privacy beat: reads 3 before check-in)
  checkedInCount: number;
  tvl: string;
  potBalance: string;
}

// Attendee's own rsvp — cids the CTAs need come from here.
export interface MyRsvp {
  status: RsvpStatus;
  checkedIn: boolean;
  inviteCid?: string;
  rsvpCid?: string;
}

// GET /api/events/{eventId} — role-adaptive union.
export interface OrganizerEventDetail {
  event: EventCore;
  meta?: EventMeta;
  stats: OrganizerStats;
  rsvps: OrganizerRsvpRow[];
  myRsvp?: undefined;
}

export interface AttendeeEventDetail {
  event: EventCore;
  meta?: EventMeta;
  myRsvp: MyRsvp;
  stats?: undefined;
  rsvps?: undefined;
}

export type EventDetail = OrganizerEventDetail | AttendeeEventDetail;

export function isOrganizerDetail(d: EventDetail): d is OrganizerEventDetail {
  // Prefer the attendee shape when myRsvp is present so an unexpected/partial
  // payload degrades to the safer panel; only treat as organizer when stats is
  // a real object (a nil Go pointer serializes as `null`, which `!= null` rejects,
  // avoiding an OrganizerPanel crash on `stats.headcount`).
  const od = d as OrganizerEventDetail;
  const ad = d as AttendeeEventDetail;
  if (ad.myRsvp != null) return false;
  return od.stats != null;
}

// POST /api/events body
export interface CreateEventBody {
  title: string;
  description: string;
  venue: string;
  stakeAmount: string;
  tokenLabel: string;
  rsvpDeadline: string; // ISO
  eventEnd: string; // ISO
}

// Settlement package — shared by POST .../close and GET .../settlement.
export type PayoutOutcome = "refunded" | "slashed";
export type PayoutStatus = "offered" | "accepted";

export interface SettlementRow {
  attendeeLabel: string;
  outcome: PayoutOutcome;
  checkedIn: boolean;
  isGhost: boolean;
  payoutAmount?: string;
  payoutStatus?: PayoutStatus;
  txId?: string; // update_id (may be offset in polling-fallback mode)
  slotId?: string;
}

export interface BalanceDelta {
  // Contract pin (architect-decided): `party` is the PERSONA LABEL (e.g. "alice"),
  // the SAME label used in settlements[].attendeeLabel — NOT the Canton party id.
  // SettlementResults joins deltas → rows on this equality.
  party: string;
  before: string;
  after: string;
}

export interface SettlementPackage {
  settlements: SettlementRow[];
  payouts: SettlementRow[]; // may overlap; UI reads settlements as the row set
  deltas: BalanceDelta[];
}

// Backend error envelope: 502 {stage, detail, errorId} / 409 {stage} (05 §2).
export interface ApiErrorBody {
  stage?: string;
  detail?: string;
  errorId?: string;
  rsvpCid?: string;
  message?: string;
}
