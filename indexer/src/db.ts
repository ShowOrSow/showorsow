// Thin pg pool wrapper + startup hydration/migration helpers.

import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import { ProjectorState } from './state.ts';

export function makePool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl });
}

/** Read the persisted last_offset (or undefined for a fresh DB → begin at offset 0 / ledger begin). */
export async function readLastOffset(pool: Pool): Promise<string | undefined> {
  const r = await pool.query<{ last_offset: string }>('SELECT last_offset FROM indexer_state WHERE id = 1');
  return r.rows[0]?.last_offset;
}

/**
 * Hydrate the in-memory ProjectorState from the DB so replay from any offset stays correct
 * (the handlers depend on last-seen cids / checked_in / pot amounts).
 */
export async function hydrateState(pool: Pool): Promise<ProjectorState> {
  const state = new ProjectorState();

  const ev = await pool.query<{
    event_id: string;
    contract_id: string;
    stake_amount: string;
    status: string;
  }>('SELECT event_id, contract_id, stake_amount, status FROM events');
  for (const r of ev.rows) {
    state.events.set(r.event_id, {
      eventId: r.event_id,
      contractId: r.contract_id,
      stakeAmount: r.stake_amount,
      status: r.status,
    });
    state.eventByCid.set(r.contract_id, r.event_id);
  }

  const rs = await pool.query<{
    event_id: string;
    attendee_party: string;
    slot_id: string;
    invite_cid: string | null;
    rsvp_cid: string | null;
    allocation_cid: string | null;
    status: string;
    checked_in: boolean;
    stake_amount: string;
  }>(
    `SELECT r.event_id, r.attendee_party, r.slot_id, r.invite_cid, r.rsvp_cid, r.allocation_cid,
            r.status, r.checked_in, e.stake_amount
       FROM rsvps r JOIN events e ON e.event_id = r.event_id`,
  );
  for (const r of rs.rows) {
    const key = { eventId: r.event_id, attendeeParty: r.attendee_party };
    state.rsvps.set(ProjectorState.rsvpKey(key), {
      ...key,
      slotId: r.slot_id,
      inviteCid: r.invite_cid,
      rsvpCid: r.rsvp_cid,
      allocationCid: r.allocation_cid,
      status: r.status,
      checkedIn: r.checked_in,
      stakeAmount: r.stake_amount,
    });
    if (r.rsvp_cid) state.rsvpByCid.set(r.rsvp_cid, key);
    if (r.invite_cid) state.rsvpByInviteCid.set(r.invite_cid, key);
    if (r.allocation_cid) state.rsvpByAllocationCid.set(r.allocation_cid, key);
  }

  const ph = await pool.query<{
    contract_id: string;
    instrument_admin: string;
    instrument_id: string;
    amount: string;
  }>('SELECT contract_id, instrument_admin, instrument_id, amount FROM pot_holdings');
  for (const r of ph.rows) {
    state.potHoldings.set(r.contract_id, {
      contractId: r.contract_id,
      instrumentAdmin: r.instrument_admin,
      instrumentId: r.instrument_id,
      amount: r.amount,
    });
  }

  return state;
}

export type { PoolClient };
