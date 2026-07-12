// Response shapes mirroring 05-backend.md §2. These are the frontend's contract
// with the Go backend — the ONLY thing the browser talks to (never the ledger).
//
// Auth pivot (Jul 11, 08 §1): PersonaSwitcher is gone. Identity is now a real
// account (Luma-style) whose signup allocates a Canton party. No global
// "persona" — a user is the organizer of the events they created, and an
// attendee of the events they were invited to (role is per-event, from the
// read model's response shape).

// The logged-in account (05 §2: {user:{email, name, partyId}}).
export interface User {
  email: string;
  name: string;
  partyId: string;
}

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

// GET /api/session → {user, indexerLagMs}. 401s when unauthenticated (the route
// guard keys off that — see SessionProvider).
export interface SessionInfo {
  user: User;
  indexerLagMs: number;
}

// Auth request bodies (05 §2).
export interface RegisterBody {
  name: string;
  email: string;
  password: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

// Auth success → session cookie + {user}.
export interface AuthResult {
  user: User;
}

// Config probe for the DEV quick-login strip. Exposed at GET /api/config so the
// UNAUTHENTICATED /login page can read it (GET /api/session 401s pre-login, so
// the dev flag can't ride on it). The strip degrades to hidden if this probe is
// absent or errors — documented choice, see /login page + api.getConfig.
export interface AppConfig {
  devQuickLogin: boolean;
  // Faucet toggle (05 §6c, DEV_FAUCET). When false the Receive sheet still shows
  // the deposit address but hides the "Get test tokens" buttons. Same probe as
  // devQuickLogin — read pre- and post-session.
  devFaucet?: boolean;
}

// POST /api/faucet {tokenLabel} → discriminated union (05 §6c):
//  · mintable demo token  → {credited, newBalance} (credits instantly)
//  · registry token (cBTC/cETH) → {external:true, url, party} (open ext. faucet)
export interface FaucetCredited {
  credited: boolean | string; // backend echoes the credited amount / flag
  newBalance: string;
}

export interface FaucetExternal {
  external: true;
  url: string;
  party: string;
}

export type FaucetResult = FaucetCredited | FaucetExternal;

export function isFaucetExternal(r: FaucetResult): r is FaucetExternal {
  return (r as FaucetExternal).external === true;
}

// A seeded demo account offered by the DEV quick-login strip. The backend only
// needs the email to POST /api/auth/dev-login; name/role are display sugar.
export interface DevAccount {
  email: string;
  name: string;
  role?: string;
}

// GET /api/tokens — configured tokens + live decimals from registry metadata
export interface Token {
  label: string;
  instrumentId: string;
  decimals: number;
  adminParty?: string;
}

// GET /api/balances — live Holding interface query for the current user
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

// GET /api/events — user-scoped list rows.
export interface EventListRow {
  event: EventCore;
  meta?: EventMeta;
  // organizer-only headcount; attendees get their own status. Presence of
  // `headcount` (not a global role) marks the row as one this user organizes.
  headcount?: number;
  myStatus?: RsvpStatus;
}

// Organizer detail rsvp row. Post-pivot: carries the invitee's real name/email
// (rows render name/email — 08 §2) and their Canton party (check-in posts
// {attendeeParty} — 05 §2).
export interface OrganizerRsvpRow {
  attendeeParty: string;
  attendeeName?: string;
  attendeeEmail?: string;
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
  // `party` is the per-attendee DISPLAY LABEL the backend uses in
  // settlements[].attendeeLabel (post-pivot: the invitee's name) — NOT the raw
  // Canton party id. SettlementResults joins deltas → rows on this equality.
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
// `error` carries the backend's human-readable text (errBody.Error) and is the
// primary toast message fallback after `detail`.
export interface ApiErrorBody {
  error?: string;
  stage?: string;
  detail?: string;
  errorId?: string;
  rsvpCid?: string;
  message?: string;
}
