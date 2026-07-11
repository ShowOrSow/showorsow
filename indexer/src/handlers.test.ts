// Unit tests for the trickiest handlers (06 §2): the cid-refresh rule, E10 vs E11
// disambiguation, E10's refund/slash outcome, and the review fixes F1/F2/F3/F6/F9 —
// LEDGER_EFFECTS synthesized archives, interface-event gating, per-cid settle, WS error safety.
//
//   node --experimental-strip-types --test src/handlers.test.ts   (or: pnpm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { loadConfig } from './config.ts';
import type { Config, QualifiedName } from './config.ts';
import { handleUpdate } from './handlers.ts';
import { applyToState } from './projector.ts';
import { ProjectorState } from './state.ts';
import { decodeUpdate } from './decode.ts';
import { startWsFeed } from './feed-ws.ts';
import type {
  LedgerUpdate,
  CreatedNode,
  ArchivedNode,
  ExercisedNode,
} from './ledger-types.ts';
import type { Upsert } from './upserts.ts';

// Minimal config with default qualified names; APP_OPERATOR/POT set for E13/E15 gates.
function cfg(): Config {
  process.env['DATABASE_URL'] = 'postgres://x';
  process.env['APP_OPERATOR_PARTY'] = 'appOperator';
  process.env['POT_PARTY'] = 'appOperator';
  return loadConfig();
}

const EVENT = { module: 'ShowOrSow', entity: 'Event' };
const STAKED = { module: 'ShowOrSow', entity: 'StakedRSVP' };
const INVITE = { module: 'ShowOrSow', entity: 'RSVPInvite' };
// Concrete implementing templates (what the wire actually carries — never the interface id).
const CONCRETE_TI = { module: 'Splice.Amulet', entity: 'AmuletTransferInstruction' };
const CONCRETE_HOLDING = { module: 'Splice.Amulet', entity: 'Amulet' };
const CONCRETE_ALLOC = { module: 'MockAllocation', entity: 'MockAllocation' };
// Interface qualified names (match names the handlers gate on).
const IF_TI = 'Splice.Api.Token.TransferInstructionV1:TransferInstruction';
const IF_HOLDING = 'Splice.Api.Token.HoldingV1:Holding';
const IF_ALLOC = { module: 'Splice.Api.Token.AllocationV1', entity: 'Allocation' };

function created(contractId: string, templateId: { module: string; entity: string }, payload: Record<string, unknown>): CreatedNode {
  return { kind: 'created', contractId, templateId, payload };
}
function createdWithView(
  contractId: string,
  templateId: { module: string; entity: string },
  viewKey: string,
  view: Record<string, unknown>,
): CreatedNode {
  return { kind: 'created', contractId, templateId, payload: {}, interfaceViews: { [viewKey]: view } };
}
function archived(
  contractId: string,
  templateId: { module: string; entity: string },
  implementedInterfaces?: QualifiedName[],
): ArchivedNode {
  return implementedInterfaces === undefined
    ? { kind: 'archived', contractId, templateId }
    : { kind: 'archived', contractId, templateId, implementedInterfaces };
}
function exercised(choice: string, templateId: { module: string; entity: string } = EVENT, contractId = 'ev0'): ExercisedNode {
  return { kind: 'exercised', contractId, templateId, choice, consuming: false };
}
function update(offset: string, nodes: (CreatedNode | ArchivedNode | ExercisedNode)[], updateId?: string): LedgerUpdate {
  return updateId === undefined ? { offset, nodes } : { offset, nodes, updateId };
}

/** Drive an update through handlers and commit into state (mirrors the projector post-commit). */
function step(u: LedgerUpdate, state: ProjectorState, c: Config): Upsert[] {
  const ups = handleUpdate(u, state, c);
  applyToState(state, ups);
  return ups;
}

// Seed a fully-staked RSVP row (event open, one accepted+staked attendee).
function seedStaked(state: ProjectorState, c: Config): void {
  step(
    update('1', [
      created('ev0', EVENT, {
        eventId: 'E1',
        organizer: 'org',
        title: 'T',
        stakeAmount: '5.0',
        instrumentAdmin: 'admin',
        instrumentId: 'CBTC',
        rsvpDeadline: '2026-01-01T00:00:00Z',
        eventEnd: '2026-01-02T00:00:00Z',
        settleBefore: '2026-01-03T00:00:00Z',
        ended: false,
      }),
    ]),
    state,
    c,
  );
  step(update('2', [created('inv1', INVITE, { eventId: 'E1', attendee: 'alice', slotId: 'S1' })]), state, c);
  // accept: invite archived + StakedRSVP created same update (E5)
  step(
    update('3', [
      archived('inv1', INVITE),
      created('rsvp1', STAKED, { eventId: 'E1', attendee: 'alice', slotId: 'S1', stakeAmount: '5.0', allocationCid: null, checkedIn: false, withdrawn: false }),
    ]),
    state,
    c,
  );
  // stake locked: recreate with allocationCid = Some (E7)
  step(
    update('4', [
      archived('rsvp1', STAKED),
      created('rsvp2', STAKED, { eventId: 'E1', attendee: 'alice', slotId: 'S1', stakeAmount: '5.0', allocationCid: 'alloc1', checkedIn: false, withdrawn: false }),
    ]),
    state,
    c,
  );
}

test('cid-refresh: every StakedRSVP recreate overwrites rsvp_cid; archive resolves by current cid', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);

  const row = state.getRsvp({ eventId: 'E1', attendeeParty: 'alice' })!;
  assert.equal(row.rsvpCid, 'rsvp2', 'rsvp_cid must point at the latest recreate cid');
  assert.equal(row.status, 'staked');
  assert.equal(row.allocationCid, 'alloc1');
  // the stale cid rsvp1 must no longer resolve
  assert.equal(state.getRsvpByCid('rsvp1'), undefined, 'old cid must be unmapped after refresh');
  assert.equal(state.getRsvpByCid('rsvp2')?.attendeeParty, 'alice');
});

test('E5: accepting an invite clears invite_cid (invite consumed, F8)', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);
  const row = state.getRsvp({ eventId: 'E1', attendeeParty: 'alice' })!;
  assert.equal(row.inviteCid, null, 'invite_cid must be cleared after accept');
  assert.equal(state.getRsvpByInviteCid('inv1'), undefined, 'stale invite cid must be unmapped');
});

test('E8 check-in: recreate flips checked_in and refreshes rsvp_cid', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);
  step(
    update('5', [
      archived('rsvp2', STAKED),
      created('rsvp3', STAKED, { eventId: 'E1', attendee: 'alice', slotId: 'S1', stakeAmount: '5.0', allocationCid: 'alloc1', checkedIn: true, withdrawn: false }),
    ]),
    state,
    c,
  );
  const row = state.getRsvp({ eventId: 'E1', attendeeParty: 'alice' })!;
  assert.equal(row.checkedIn, true);
  assert.equal(row.rsvpCid, 'rsvp3');
  assert.equal(row.status, 'staked', 'check-in does not change status');
});

test('E10 disambiguation: StakedRSVP archived WITH a CloseEvent exercise => settlement inserted', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);
  // not checked in -> slash. CloseEvent-on-Event is the global settle signal (F9).
  const ups = step(update('6', [archived('rsvp2', STAKED), exercised('CloseEvent')], 'upd-6'), state, c);
  const settle = ups.find((u) => u.op === 'insertSettlement');
  assert.ok(settle, 'E10 must insert a settlement');
  assert.equal(settle!.op === 'insertSettlement' && settle!.outcome, 'slash', 'not checked in => slash');
  assert.equal(settle!.op === 'insertSettlement' && settle!.amount, '5.0');
  assert.equal(settle!.op === 'insertSettlement' && settle!.updateId, 'upd-6', 'WS path uses the update id');
  const patch = ups.find((u) => u.op === 'patchRsvp');
  assert.equal(patch && patch.op === 'patchRsvp' && patch.set.status, 'settled');
});

test('F9: an unrelated Settle choice on a non-StakedRSVP template does NOT settle', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);
  // A registry-internal "Settle" on some other template must not misfire E10 (F9).
  const ups = step(update('6', [archived('rsvp2', STAKED), exercised('Settle', { module: 'Registry', entity: 'Whatever' })], 'upd-6'), state, c);
  assert.equal(ups.find((u) => u.op === 'insertSettlement'), undefined, 'stray Settle must not settle');
  const patch = ups.find((u) => u.op === 'patchRsvp');
  assert.equal(patch && patch.op === 'patchRsvp' && patch.set.status, 'cancelled', 'no valid settle => E11 cancelled');
});

test('E10 via LEDGER_EFFECTS: consuming exercises decode into synthesized archives => settlement (F1)', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);
  // Raw LEDGER_EFFECTS envelope: NO ArchivedEvents — a CloseEvent on the Event + the consuming
  // exercise that archives the stake. decode.ts must synthesize the archive nodes.
  const raw = {
    transaction: {
      offset: '6',
      updateId: 'upd-6',
      events: [
        { ExercisedEvent: { contractId: 'ev0', templateId: 'pkg:ShowOrSow:Event', choice: 'CloseEvent', consuming: true } },
        { ExercisedEvent: { contractId: 'rsvp2', templateId: 'pkg:ShowOrSow:StakedRSVP', choice: 'Archive', consuming: true } },
      ],
    },
  };
  const decoded = decodeUpdate(raw);
  assert.ok(decoded, 'envelope must decode');
  assert.ok(
    decoded!.nodes.some((n) => n.kind === 'archived' && n.contractId === 'rsvp2'),
    'a consuming StakedRSVP exercise must synthesize an archived node',
  );
  const ups = step(decoded!, state, c);
  const settle = ups.find((u) => u.op === 'insertSettlement');
  assert.ok(settle, 'settlement must be inserted from the synthesized archive');
  assert.equal(settle!.op === 'insertSettlement' && settle!.outcome, 'slash');
  assert.equal(settle!.op === 'insertSettlement' && settle!.updateId, 'upd-6');
  assert.equal(state.events.get('E1')!.status, 'settled', 'CloseEvent also settles the Event (E3)');
});

test('E10 outcome uses last-seen checked_in: checked in => refund', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);
  step(
    update('5', [
      archived('rsvp2', STAKED),
      created('rsvp3', STAKED, { eventId: 'E1', attendee: 'alice', slotId: 'S1', stakeAmount: '5.0', allocationCid: 'alloc1', checkedIn: true, withdrawn: false }),
    ]),
    state,
    c,
  );
  const ups = step(update('6', [archived('rsvp3', STAKED), exercised('CloseEvent')], 'upd-6'), state, c);
  const settle = ups.find((u) => u.op === 'insertSettlement');
  assert.equal(settle && settle.op === 'insertSettlement' && settle.outcome, 'refund', 'checked in => refund');
});

test('E11 disambiguation: StakedRSVP archived with NO settle exercise => cancelled, no settlement', () => {
  const c = cfg();
  const state = new ProjectorState();
  seedStaked(state, c);
  const ups = step(update('6', [archived('rsvp2', STAKED)], 'upd-6'), state, c);
  assert.equal(ups.find((u) => u.op === 'insertSettlement'), undefined, 'E11 must NOT settle');
  const patch = ups.find((u) => u.op === 'patchRsvp');
  assert.equal(patch && patch.op === 'patchRsvp' && patch.set.status, 'cancelled');
});

test('E5 vs E6: invite archived WITHOUT a StakedRSVP create => declined', () => {
  const c = cfg();
  const state = new ProjectorState();
  step(
    update('1', [
      created('ev0', EVENT, { eventId: 'E1', organizer: 'org', title: 'T', stakeAmount: '5.0', instrumentAdmin: 'admin', instrumentId: 'CBTC', rsvpDeadline: 'x', eventEnd: 'x', settleBefore: 'x', ended: false }),
    ]),
    state,
    c,
  );
  step(update('2', [created('inv1', INVITE, { eventId: 'E1', attendee: 'bob', slotId: 'S2' })]), state, c);
  const ups = step(update('3', [archived('inv1', INVITE)]), state, c);
  const patch = ups.find((u) => u.op === 'patchRsvp');
  assert.equal(patch && patch.op === 'patchRsvp' && patch.set.status, 'declined');
  assert.equal(state.getRsvp({ eventId: 'E1', attendeeParty: 'bob' })!.status, 'declined');
});

test('F4: E3 does NOT clobber an E2 recreate — Event archived+recreated(ended) in one update stays ended', () => {
  const c = cfg();
  const state = new ProjectorState();
  step(
    update('1', [
      created('ev0', EVENT, { eventId: 'E1', organizer: 'org', title: 'T', stakeAmount: '5.0', instrumentAdmin: 'admin', instrumentId: 'CBTC', rsvpDeadline: 'x', eventEnd: 'x', settleBefore: 'x', ended: false }),
    ]),
    state,
    c,
  );
  // EndEventEarly: archive old cid + recreate ended=true, same update. Regardless of node order the
  // archive must NOT emit setEventStatus('settled').
  const ups = step(
    update('2', [
      archived('ev0', EVENT),
      created('ev1', EVENT, { eventId: 'E1', organizer: 'org', title: 'T', stakeAmount: '5.0', instrumentAdmin: 'admin', instrumentId: 'CBTC', rsvpDeadline: 'x', eventEnd: 'x', settleBefore: 'x', ended: true }),
    ]),
    state,
    c,
  );
  assert.equal(ups.find((u) => u.op === 'setEventStatus'), undefined, 'no spurious settle on the recreate archive');
  assert.equal(state.events.get('E1')!.status, 'ended');
  assert.equal(state.events.get('E1')!.contractId, 'ev1', 'contract_id refreshed to the recreate');
});

test('E13: TransferInstruction payout gated on the interface VIEW, not templateId (F2)', () => {
  const c = cfg();
  const state = new ProjectorState();
  // Concrete template AmuletTransferInstruction, but the pot-out leg arrives via the interface view.
  const node = createdWithView('ti1', CONCRETE_TI, IF_TI, {
    transfer: {
      sender: 'appOperator',
      receiver: 'alice',
      amount: '5.0',
      meta: { values: { 'showorsow.dev/event': 'E1' } },
    },
  });
  const ups = handleUpdate(update('7', [node]), state, c);
  const payout = ups.find((u) => u.op === 'insertPayout');
  assert.ok(payout, 'payout must fire from the interface view despite the concrete templateId');
  assert.equal(payout!.op === 'insertPayout' && payout!.eventId, 'E1');
  assert.equal(payout!.op === 'insertPayout' && payout!.attendeeParty, 'alice');
  assert.equal(payout!.op === 'insertPayout' && payout!.amount, '5.0');
});

test('E15/E15b: pot Holding create+archive via interface view / stored cid (F2)', () => {
  const c = cfg();
  const state = new ProjectorState();
  const createNode = createdWithView('h1', CONCRETE_HOLDING, IF_HOLDING, {
    owner: 'appOperator',
    amount: '5.0',
    instrumentId: { admin: 'admin', id: 'CBTC' },
  });
  const ups1 = step(update('8', [createNode]), state, c);
  assert.ok(ups1.find((u) => u.op === 'upsertPotHolding'), 'holding create must upsert pot_holdings');
  assert.equal(state.potHoldings.has('h1'), true);
  // Archive carries the concrete templateId and no interface hint — stored-cid fallback must match.
  const ups2 = step(update('9', [archived('h1', CONCRETE_HOLDING)]), state, c);
  assert.ok(ups2.find((u) => u.op === 'deletePotHolding'), 'E15b must delete by stored cid');
  assert.equal(state.potHoldings.has('h1'), false);
});

test('E12: out-of-band Allocation_Withdraw flags withdrawal; a CancelRSVP does NOT (F1/F2)', () => {
  // Out-of-band: allocation archived, stake still alive => withdrawal_detected.
  {
    const c = cfg();
    const state = new ProjectorState();
    seedStaked(state, c); // rsvp2 staked, allocation alloc1
    const ups = step(update('10', [archived('alloc1', CONCRETE_ALLOC, [IF_ALLOC])]), state, c);
    const patch = ups.find((u) => u.op === 'patchRsvp');
    assert.ok(patch, 'E12 must patch the row');
    assert.equal(patch!.op === 'patchRsvp' && patch!.set.withdrawalDetected, true);
  }
  // CancelRSVP: the stake's own StakedRSVP is archived in the SAME update => NOT a withdrawal.
  {
    const c = cfg();
    const state = new ProjectorState();
    seedStaked(state, c);
    const ups = step(update('10', [archived('rsvp2', STAKED), archived('alloc1', CONCRETE_ALLOC, [IF_ALLOC])]), state, c);
    const withdrawal = ups.find((u) => u.op === 'patchRsvp' && u.set.withdrawalDetected === true);
    assert.equal(withdrawal, undefined, 'Allocation_Cancel within a CancelRSVP must not set withdrawal_detected');
    const cancel = ups.find((u) => u.op === 'patchRsvp' && u.set.status === 'cancelled');
    assert.ok(cancel, 'the stake archive is E11 cancelled');
  }
});

test('F3: a WS projection error closes the socket and never advances past the failed update', async () => {
  const c = cfg();
  const wss = new WebSocketServer({ port: 0 });
  await once(wss, 'listening');
  const port = (wss.address() as AddressInfo).port;
  c.ledgerWsBase = `ws://127.0.0.1:${port}`;

  let committedOffset: string | undefined; // mirrors indexer_state.last_offset
  const seen: string[] = [];
  const frameB = JSON.stringify({ transaction: { offset: 'B', updateId: 'b', events: [] } });
  const frameC = JSON.stringify({ transaction: { offset: 'C', updateId: 'c', events: [] } });

  const serverClosed = new Promise<void>((resolve) => {
    wss.on('connection', (sock) => {
      sock.on('close', () => resolve());
      // On subscribe, push B then C. B's projection throws → offset must NOT advance to C.
      sock.once('message', () => {
        sock.send(frameB);
        sock.send(frameC);
      });
    });
  });

  const feed = startWsFeed(c, {
    async onUpdate(u) {
      seen.push(u.offset);
      if (u.offset === 'B') throw new Error('boom'); // transient projection failure
      committedOffset = u.offset; // only reached on success
    },
    currentOffset() {
      return committedOffset;
    },
    onError() {
      /* swallowed by the test; the feeder handles the close itself */
    },
  });

  // The failing update must drop the socket.
  await Promise.race([serverClosed, new Promise((_, rej) => setTimeout(() => rej(new Error('socket did not close')), 3000))]);
  feed.stop();
  wss.close();

  assert.ok(seen.includes('B'), 'B was delivered');
  assert.equal(seen.includes('C'), false, 'C must NOT be projected after B failed (no offset advance)');
  assert.equal(committedOffset, undefined, 'offset never advanced past the failed update');
});
