// Projector — the exactly-once boundary (06 §1).
//
// For each update:
//   1. run the pure handlers to get Upsert[] (reads ProjectorState, no side effects);
//   2. BEGIN; apply every Upsert as parameterized SQL; UPDATE indexer_state.last_offset;
//      COMMIT — all in ONE transaction;
//   3. only after a successful COMMIT, mutate the in-memory ProjectorState.
//
// settlements/payouts inserts use ON CONFLICT DO NOTHING, so replay from any offset (incl. 0)
// is safe. If the commit throws, state is untouched and the update can be re-fed.

import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.ts';
import type { LedgerUpdate } from './ledger-types.ts';
import { handleUpdate } from './handlers.ts';
import { ProjectorState } from './state.ts';
import type { Upsert } from './upserts.ts';

export class Projector {
  private lastOffset: string | undefined;
  private readonly pool: Pool;
  private readonly cfg: Config;
  private readonly state: ProjectorState;

  constructor(pool: Pool, cfg: Config, state: ProjectorState, initialOffset: string | undefined) {
    this.pool = pool;
    this.cfg = cfg;
    this.state = state;
    this.lastOffset = initialOffset;
  }

  getLastOffset(): string | undefined {
    return this.lastOffset;
  }

  /** Process one update atomically. Returns the emitted upserts (useful for tests/telemetry). */
  async apply(update: LedgerUpdate): Promise<Upsert[]> {
    const upserts = handleUpdate(update, this.state, this.cfg);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const u of upserts) {
        await execUpsert(client, u);
      }
      await client.query(
        `INSERT INTO indexer_state (id, last_offset, updated_at) VALUES (1, $1, now())
           ON CONFLICT (id) DO UPDATE SET last_offset = EXCLUDED.last_offset, updated_at = now()`,
        [update.offset],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    // Commit succeeded — advance in-memory state.
    applyToState(this.state, upserts);
    this.lastOffset = update.offset;
    return upserts;
  }
}

// --- SQL for each upsert op -------------------------------------------------

async function execUpsert(c: PoolClient, u: Upsert): Promise<void> {
  switch (u.op) {
    case 'upsertEvent':
      await c.query(
        `INSERT INTO events
           (event_id, contract_id, organizer_party, title, stake_amount, instrument_admin,
            instrument_id, rsvp_deadline, event_end, settle_before, status, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT (event_id) DO UPDATE SET
           contract_id = EXCLUDED.contract_id,
           organizer_party = EXCLUDED.organizer_party,
           title = EXCLUDED.title,
           stake_amount = EXCLUDED.stake_amount,
           instrument_admin = EXCLUDED.instrument_admin,
           instrument_id = EXCLUDED.instrument_id,
           rsvp_deadline = EXCLUDED.rsvp_deadline,
           event_end = EXCLUDED.event_end,
           settle_before = EXCLUDED.settle_before,
           status = EXCLUDED.status,
           updated_at = now()`,
        [
          u.eventId,
          u.contractId,
          u.organizerParty,
          u.title,
          u.stakeAmount,
          u.instrumentAdmin,
          u.instrumentId,
          u.rsvpDeadline,
          u.eventEnd,
          u.settleBefore,
          u.status,
        ],
      );
      return;

    case 'setEventStatus':
      if (u.eventId !== undefined) {
        await c.query(
          `UPDATE events SET status = $2,
             contract_id = COALESCE($3, contract_id), updated_at = now()
           WHERE event_id = $1`,
          [u.eventId, u.status, u.contractId ?? null],
        );
      } else if (u.byContractId !== undefined) {
        await c.query(
          `UPDATE events SET status = $2, updated_at = now() WHERE contract_id = $1`,
          [u.byContractId, u.status],
        );
      }
      return;

    case 'upsertRsvp':
      await c.query(
        `INSERT INTO rsvps (event_id, attendee_party, slot_id, invite_cid, status, updated_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (event_id, attendee_party) DO UPDATE SET
           slot_id = EXCLUDED.slot_id,
           invite_cid = EXCLUDED.invite_cid,
           status = EXCLUDED.status,
           updated_at = now()`,
        [u.eventId, u.attendeeParty, u.slotId, u.inviteCid, u.status],
      );
      return;

    case 'patchRsvp': {
      const sets: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const s = u.set;
      if (s.status !== undefined) {
        sets.push(`status = $${i++}`);
        vals.push(s.status);
      }
      if (s.rsvpCid !== undefined) {
        sets.push(`rsvp_cid = $${i++}`);
        vals.push(s.rsvpCid);
      }
      if (s.inviteCid !== undefined) {
        sets.push(`invite_cid = $${i++}`);
        vals.push(s.inviteCid);
      }
      if (s.allocationCid !== undefined) {
        sets.push(`allocation_cid = $${i++}`);
        vals.push(s.allocationCid);
      }
      if (s.checkedIn !== undefined) {
        sets.push(`checked_in = $${i++}`);
        vals.push(s.checkedIn);
      }
      if (s.withdrawalDetected !== undefined) {
        sets.push(`withdrawal_detected = $${i++}`);
        vals.push(s.withdrawalDetected);
      }
      if (sets.length === 0) return; // no-op patch (E5 invite-consumed marker)
      sets.push('updated_at = now()');

      if (u.key !== undefined) {
        vals.push(u.key.eventId, u.key.attendeeParty);
        await c.query(
          `UPDATE rsvps SET ${sets.join(', ')} WHERE event_id = $${i++} AND attendee_party = $${i++}`,
          vals,
        );
      } else if (u.byRsvpCid !== undefined) {
        vals.push(u.byRsvpCid);
        await c.query(`UPDATE rsvps SET ${sets.join(', ')} WHERE rsvp_cid = $${i++}`, vals);
      } else if (u.byInviteCid !== undefined) {
        vals.push(u.byInviteCid);
        await c.query(`UPDATE rsvps SET ${sets.join(', ')} WHERE invite_cid = $${i++}`, vals);
      }
      return;
    }

    case 'insertSettlement':
      await c.query(
        `INSERT INTO settlements (event_id, attendee_party, outcome, amount, update_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (event_id, attendee_party) DO NOTHING`,
        [u.eventId, u.attendeeParty, u.outcome, u.amount, u.updateId],
      );
      return;

    case 'insertPayout':
      await c.query(
        `INSERT INTO payouts (event_id, attendee_party, amount, transfer_cid, status, updated_at)
         VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (transfer_cid) DO NOTHING`,
        [u.eventId, u.attendeeParty, u.amount, u.transferCid, u.status],
      );
      return;

    case 'setPayoutAccepted':
      await c.query(
        `UPDATE payouts SET status = 'accepted', updated_at = now() WHERE transfer_cid = $1`,
        [u.transferCid],
      );
      return;

    case 'insertPayoutUnattributed':
      await c.query(
        `INSERT INTO payouts_unattributed (transfer_cid, attendee_party, amount)
         VALUES ($1,$2,$3)
         ON CONFLICT (transfer_cid) DO NOTHING`,
        [u.transferCid, u.attendeeParty, u.amount],
      );
      return;

    case 'upsertPotHolding':
      await c.query(
        `INSERT INTO pot_holdings (contract_id, instrument_admin, instrument_id, amount)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (contract_id) DO UPDATE SET
           instrument_admin = EXCLUDED.instrument_admin,
           instrument_id = EXCLUDED.instrument_id,
           amount = EXCLUDED.amount`,
        [u.contractId, u.instrumentAdmin, u.instrumentId, u.amount],
      );
      return;

    case 'deletePotHolding':
      await c.query(`DELETE FROM pot_holdings WHERE contract_id = $1`, [u.contractId]);
      return;
  }
}

// --- in-memory state mutation (post-commit) ---------------------------------

export function applyToState(state: ProjectorState, upserts: Upsert[]): void {
  for (const u of upserts) {
    switch (u.op) {
      case 'upsertEvent': {
        const prior = state.events.get(u.eventId);
        if (prior && prior.contractId !== u.contractId) {
          state.eventByCid.delete(prior.contractId);
        }
        state.events.set(u.eventId, {
          eventId: u.eventId,
          contractId: u.contractId,
          stakeAmount: u.stakeAmount,
          status: u.status,
        });
        state.eventByCid.set(u.contractId, u.eventId);
        break;
      }
      case 'setEventStatus': {
        let eventId = u.eventId;
        if (eventId === undefined && u.byContractId !== undefined) {
          eventId = state.eventByCid.get(u.byContractId);
        }
        if (eventId === undefined) break;
        const ev = state.events.get(eventId);
        if (ev) {
          ev.status = u.status;
          if (u.contractId !== undefined && u.contractId !== ev.contractId) {
            state.eventByCid.delete(ev.contractId);
            ev.contractId = u.contractId;
            state.eventByCid.set(u.contractId, eventId);
          }
        }
        break;
      }
      case 'upsertRsvp': {
        const key = { eventId: u.eventId, attendeeParty: u.attendeeParty };
        const kk = ProjectorState.rsvpKey(key);
        const existing = state.rsvps.get(kk);
        const stakeAmount = existing?.stakeAmount ?? state.events.get(u.eventId)?.stakeAmount ?? '0';
        if (existing?.inviteCid && existing.inviteCid !== u.inviteCid) {
          state.rsvpByInviteCid.delete(existing.inviteCid);
        }
        state.rsvps.set(kk, {
          ...key,
          slotId: u.slotId,
          inviteCid: u.inviteCid,
          rsvpCid: existing?.rsvpCid ?? null,
          allocationCid: existing?.allocationCid ?? null,
          status: u.status,
          checkedIn: existing?.checkedIn ?? false,
          stakeAmount,
        });
        state.rsvpByInviteCid.set(u.inviteCid, key);
        break;
      }
      case 'patchRsvp': {
        const row = resolveRsvp(state, u);
        if (!row) break;
        const key = { eventId: row.eventId, attendeeParty: row.attendeeParty };
        const s = u.set;
        if (s.status !== undefined) row.status = s.status;
        if (s.checkedIn !== undefined) row.checkedIn = s.checkedIn;
        if (s.inviteCid !== undefined) {
          if (row.inviteCid) state.rsvpByInviteCid.delete(row.inviteCid);
          row.inviteCid = s.inviteCid;
          if (s.inviteCid) state.rsvpByInviteCid.set(s.inviteCid, key);
        }
        if (s.rsvpCid !== undefined) {
          if (row.rsvpCid) state.rsvpByCid.delete(row.rsvpCid);
          row.rsvpCid = s.rsvpCid;
          if (s.rsvpCid) state.rsvpByCid.set(s.rsvpCid, key);
        }
        if (s.allocationCid !== undefined) {
          if (row.allocationCid) state.rsvpByAllocationCid.delete(row.allocationCid);
          row.allocationCid = s.allocationCid;
          if (s.allocationCid) state.rsvpByAllocationCid.set(s.allocationCid, key);
        }
        break;
      }
      case 'upsertPotHolding':
        state.potHoldings.set(u.contractId, {
          contractId: u.contractId,
          instrumentAdmin: u.instrumentAdmin,
          instrumentId: u.instrumentId,
          amount: u.amount,
        });
        break;
      case 'deletePotHolding':
        state.potHoldings.delete(u.contractId);
        break;
      // settlements / payouts / unattributed are not needed in the hot snapshot.
      default:
        break;
    }
  }
}

function resolveRsvp(state: ProjectorState, u: Extract<Upsert, { op: 'patchRsvp' }>) {
  if (u.key) return state.getRsvp(u.key);
  if (u.byRsvpCid) return state.getRsvpByCid(u.byRsvpCid);
  if (u.byInviteCid) return state.getRsvpByInviteCid(u.byInviteCid);
  return undefined;
}
