// Upsert command model — the OUTPUT of the pure E1–E16 handlers.
//
// Handlers are pure `(update, state) => Upsert[]` functions (06 §5): they never touch the
// DB. They read a small in-memory ProjectorState snapshot (last-seen rows, needed for the
// cid-refresh archive resolution, E10 outcome, E15b amount recall) and emit declarative
// Upsert commands. The projector translates each Upsert into parameterized SQL and runs the
// whole update's batch + the indexer_state advance in ONE transaction (06 §1).

export type Upsert =
  | UpsertEvent
  | SetEventStatus
  | UpsertRsvp
  | PatchRsvp
  | InsertSettlement
  | InsertPayout
  | SetPayoutAccepted
  | InsertPayoutUnattributed
  | UpsertPotHolding
  | DeletePotHolding;

/** E1/E2: full upsert of an events row; contract_id ALWAYS refreshed (cid-refresh rule). */
export interface UpsertEvent {
  op: 'upsertEvent';
  eventId: string;
  contractId: string;
  organizerParty: string;
  title: string;
  stakeAmount: string;
  instrumentAdmin: string;
  instrumentId: string;
  rsvpDeadline: string;
  eventEnd: string;
  settleBefore: string;
  status: 'open' | 'ended' | 'settled';
}

/** E2/E3: status-only change (E2 also refreshes contract_id via contractId). */
export interface SetEventStatus {
  op: 'setEventStatus';
  /** Resolve the row by CURRENT contract_id when eventId is unknown (E3 archive). */
  byContractId?: string;
  eventId?: string;
  status: 'open' | 'ended' | 'settled';
  /** E2 refreshes contract_id while flipping to 'ended'. */
  contractId?: string;
}

/** E4: upsert an rsvps row from an RSVPInvite create. */
export interface UpsertRsvp {
  op: 'upsertRsvp';
  eventId: string;
  attendeeParty: string;
  slotId: string;
  inviteCid: string;
  status: 'invited';
}

/**
 * E5–E12/E16: patch an existing rsvps row. Rows may be resolved either by
 * (eventId, attendeeParty) or by the CURRENT rsvp_cid (archive handlers, cid-refresh rule).
 */
export interface PatchRsvp {
  op: 'patchRsvp';
  byRsvpCid?: string;
  byInviteCid?: string;
  key?: { eventId: string; attendeeParty: string };
  set: {
    status?: 'invited' | 'declined' | 'accepted' | 'staked' | 'withdrawn' | 'cancelled' | 'settled';
    rsvpCid?: string | null;
    inviteCid?: string | null;
    allocationCid?: string | null;
    checkedIn?: boolean;
    withdrawalDetected?: boolean;
  };
}

/** E10: insert settlement, ON CONFLICT (event_id, attendee_party) DO NOTHING. */
export interface InsertSettlement {
  op: 'insertSettlement';
  eventId: string;
  attendeeParty: string;
  outcome: 'refund' | 'slash';
  amount: string;
  updateId: string | null;
}

/** E13: insert payout, ON CONFLICT (transfer_cid) DO NOTHING. */
export interface InsertPayout {
  op: 'insertPayout';
  eventId: string;
  attendeeParty: string;
  amount: string;
  transferCid: string;
  status: 'offered';
}

/** E14: mark payout accepted, resolved by transfer_cid. */
export interface SetPayoutAccepted {
  op: 'setPayoutAccepted';
  transferCid: string;
}

/** E13 fallback: meta missing → log to payouts_unattributed (alert). */
export interface InsertPayoutUnattributed {
  op: 'insertPayoutUnattributed';
  transferCid: string;
  attendeeParty: string;
  amount: string;
}

/** E15: upsert a pot Holding row (contract_id PK). */
export interface UpsertPotHolding {
  op: 'upsertPotHolding';
  contractId: string;
  instrumentAdmin: string;
  instrumentId: string;
  amount: string;
}

/** E15b: delete a pot Holding row by cid (amount recalled from the stored row). */
export interface DeletePotHolding {
  op: 'deletePotHolding';
  contractId: string;
}
