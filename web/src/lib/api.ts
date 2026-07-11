// Single typed API client mirroring 05-backend.md §2. ALL calls go to the Go
// backend at NEXT_PUBLIC_API_URL — NEVER a direct ledger call from the browser.

import type {
  ApiErrorBody,
  Balance,
  CreateEventBody,
  EventDetail,
  EventListRow,
  MyRsvp,
  OrganizerRsvpRow,
  Persona,
  SessionInfo,
  SessionPost,
  SettlementPackage,
  Token,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8080";

// Structured error carrying the backend's {stage, errorId} envelope so error
// toasts stay debuggable on camera (08 §1).
export class ApiError extends Error {
  status: number;
  stage?: string;
  errorId?: string;
  detail?: string;
  rsvpCid?: string;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.detail || body.message || body.stage || `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.stage = body.stage;
    this.errorId = body.errorId;
    this.detail = body.detail;
    this.rsvpCid = body.rsvpCid;
    this.body = body;
  }
}

async function parseBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // non-JSON body — surface as detail
    return text as unknown as T;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { json, headers, ...rest } = init ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include", // signed session cookie (05 §2)
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    ...rest,
  });

  if (!res.ok) {
    const body = await parseBody<ApiErrorBody>(res);
    const errBody: ApiErrorBody =
      body && typeof body === "object" ? body : { detail: String(body ?? "") };
    throw new ApiError(res.status, errBody);
  }

  return parseBody<T>(res);
}

// The SWR fetcher — keyed by path.
export const fetcher = <T>(path: string): Promise<T> => request<T>(path);

export const api = {
  // Session / persona
  getSession: () => request<SessionInfo>("/api/session"),
  setSession: (persona: Persona) =>
    request<SessionPost>("/api/session", { method: "POST", json: { persona } }),

  // Reference data
  getTokens: () => request<Token[]>("/api/tokens"),
  getBalances: () => request<Balance[]>("/api/balances"),

  // Events
  getEvents: () => request<EventListRow[]>("/api/events"),
  getEvent: (eventId: string) =>
    request<EventDetail>(`/api/events/${encodeURIComponent(eventId)}`),
  createEvent: (body: CreateEventBody) =>
    request<{ eventId: string }>("/api/events", { method: "POST", json: body }),

  // Organizer actions
  invite: (eventId: string, attendeePersona: Persona) =>
    request<OrganizerRsvpRow>(
      `/api/events/${encodeURIComponent(eventId)}/invites`,
      { method: "POST", json: { attendeePersona } },
    ),
  checkin: (eventId: string, attendeePersona: Persona) =>
    request<OrganizerRsvpRow>(
      `/api/events/${encodeURIComponent(eventId)}/checkin`,
      { method: "POST", json: { attendeePersona } },
    ),
  close: (eventId: string) =>
    request<SettlementPackage>(
      `/api/events/${encodeURIComponent(eventId)}/close`,
      { method: "POST" },
    ),
  getSettlement: (eventId: string) =>
    request<SettlementPackage>(
      `/api/events/${encodeURIComponent(eventId)}/settlement`,
    ),

  // Attendee actions
  accept: (inviteCid: string) =>
    request<MyRsvp>(`/api/invites/${encodeURIComponent(inviteCid)}/accept`, {
      method: "POST",
    }),
  decline: (inviteCid: string) =>
    request<MyRsvp>(`/api/invites/${encodeURIComponent(inviteCid)}/decline`, {
      method: "POST",
    }),
  stake: (rsvpCid: string) =>
    request<MyRsvp>(`/api/rsvps/${encodeURIComponent(rsvpCid)}/stake`, {
      method: "POST",
    }),
  cancel: (rsvpCid: string) =>
    request<MyRsvp>(`/api/rsvps/${encodeURIComponent(rsvpCid)}/cancel`, {
      method: "POST",
    }),
};

// Formatting helpers for amounts (mono / tabular-nums surfaces).
//
// RENDER-PRECISION LIMIT: amounts are stored as strings (types.ts) to preserve
// token precision, but this display formatter routes them through JS `Number`
// and caps the fraction at `maxDecimals` (default 8). Tokens with more than 8
// decimal places will render truncated, and float math on the parsed value can
// show artifacts. This is display-only and harmless at the demo's 0.01-CBTC
// scale; pass the token's registry `decimals` (GET /api/tokens) to render the
// exact configured precision. It does NOT affect the string values sent to the
// backend, which stay untouched.
export function formatAmount(
  amount: string | number | undefined,
  maxDecimals = 8,
): string {
  if (amount === undefined || amount === null || amount === "") return "—";
  const n = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(n)) return String(amount);
  // trim trailing zeros but keep meaningful precision
  return n.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
}

export function truncatePartyId(partyId: string | undefined, head = 10, tail = 6): string {
  if (!partyId) return "";
  if (partyId.length <= head + tail + 1) return partyId;
  return `${partyId.slice(0, head)}…${partyId.slice(-tail)}`;
}
