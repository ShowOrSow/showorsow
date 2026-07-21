// The E1–E16 event catalog (06 §2) as PURE functions.
//
//   handleUpdate(update, state, cfg) => Upsert[]
//
// Purity contract (06 §5): no DB access, no mutation of `state`. The function reads the
// last-seen ProjectorState snapshot and emits declarative Upsert commands. The projector
// executes the batch + the indexer_state advance in one transaction, then mutates state.
//
// Correlation is per-update: E5/E10/E16 look at the exercise/create nodes present in the SAME
// update to disambiguate (06 §2 correlation notes). E10's outcome uses the projector's own
// last-seen rsvps.checked_in — correct because recreates are strictly ordered per contract chain.

import type { Config, QualifiedName } from './config.ts';
import type { LedgerUpdate, CreatedNode, ArchivedNode, ExercisedNode } from './ledger-types.ts';
import { nameEq } from './ledger-types.ts';
import type { ProjectorState } from './state.ts';
import type { Upsert } from './upserts.ts';
import { asString, asDecimal, asBool, optional, getField, metaLookup } from './payload.ts';

// --- node partitioning ------------------------------------------------------

function creates(u: LedgerUpdate): CreatedNode[] {
  return u.nodes.filter((n): n is CreatedNode => n.kind === 'created');
}
function exercises(u: LedgerUpdate): ExercisedNode[] {
  return u.nodes.filter((n): n is ExercisedNode => n.kind === 'exercised');
}

function isTemplate(n: { templateId: QualifiedName }, q: QualifiedName): boolean {
  return nameEq(n.templateId, q);
}

/** True if the create carries the interface's view (interface filter delivered it) — F2. */
function hasInterfaceView(n: CreatedNode, q: QualifiedName): boolean {
  return n.interfaceViews?.[qn(q)] !== undefined;
}

/** True if the archived contract's template implements the given interface (F2). */
function implementsInterface(n: ArchivedNode, q: QualifiedName): boolean {
  return n.implementedInterfaces?.some((i) => nameEq(i, q)) === true;
}

/**
 * Settle signals for E10 vs E11 (06 §2, F6/F9). Two shapes:
 *   - GLOBAL: a `CloseEvent` exercise ON THE EVENT settles every stake of that event (WS primary).
 *   - PER-CID: a `Settle` exercise ON A StakedRSVP (carrying that stake's cid) settles only that row.
 *     The polling fallback emits per-cid Settle nodes so one attendee's cancel never contaminates
 *     another row's window (F6). Choice matching is restricted to the owning template so an unrelated
 *     registry-internal `Settle`/`CloseEvent` in the same tree can't misfire (F9).
 */
function settleSignals(u: LedgerUpdate, t: Config['templates']): { global: boolean; cids: Set<string> } {
  let global = false;
  const cids = new Set<string>();
  for (const e of exercises(u)) {
    if (e.choice === 'CloseEvent' && isTemplate(e, t.event)) global = true;
    if (e.choice === 'Settle' && isTemplate(e, t.stakedRsvp) && e.contractId) cids.add(e.contractId);
  }
  return { global, cids };
}

/** True if an AllocationRequest_Reject/_Withdraw interface choice targets a StakedRSVP (E16, F9). */
function hasAllocationRequestCancel(u: LedgerUpdate, t: Config['templates']): boolean {
  return exercises(u).some(
    (e) =>
      (e.choice === 'AllocationRequest_Reject' || e.choice === 'AllocationRequest_Withdraw') &&
      (isTemplate(e, t.stakedRsvp) || e.interfaceId?.entity === 'AllocationRequest'),
  );
}

// --- StakedRSVP payload projection ------------------------------------------

interface StakedFields {
  eventId: string;
  attendeeParty: string;
  slotId: string;
  stakeAmount: string;
  allocationCid: string | null;
  checkedIn: boolean;
  withdrawn: boolean;
}

function readStaked(p: Record<string, unknown>): StakedFields | undefined {
  const eventId = asString(getField(p, 'eventId'));
  const attendeeParty = asString(getField(p, 'attendee'));
  const slotId = asString(getField(p, 'slotId'));
  const stakeAmount = asDecimal(getField(p, 'stakeAmount'));
  if (eventId === undefined || attendeeParty === undefined || slotId === undefined || stakeAmount === undefined) {
    return undefined;
  }
  const allocRaw = optional(getField(p, 'allocationCid'));
  return {
    eventId,
    attendeeParty,
    slotId,
    stakeAmount,
    allocationCid: allocRaw === undefined ? null : (asString(allocRaw) ?? null),
    checkedIn: asBool(getField(p, 'checkedIn')) ?? false,
    withdrawn: asBool(getField(p, 'withdrawn')) ?? false,
  };
}

// --- top-level dispatch -----------------------------------------------------

export function handleUpdate(u: LedgerUpdate, state: ProjectorState, cfg: Config): Upsert[] {
  const out: Upsert[] = [];
  const t = cfg.templates;

  // Settle signals disambiguate E10 (settled) vs E11 (cancelled): a global CloseEvent-on-Event or a
  // per-cid Settle-on-StakedRSVP (F6/F9).
  const settle = settleSignals(u, t);
  const allocReqCancel = hasAllocationRequestCancel(u, t); // E16

  // Are there any StakedRSVP creates in this update? Disambiguates E5 (accept) vs E6 (decline).
  const stakedCreatesInUpdate = creates(u).filter((c) => isTemplate(c, t.stakedRsvp));

  for (const node of u.nodes) {
    if (node.kind === 'created') {
      handleCreate(node, state, cfg, out);
    } else if (node.kind === 'archived') {
      handleArchive(node, u, state, cfg, out, { settle, allocReqCancel, stakedCreatesInUpdate });
    }
    // exercise nodes carry no projection of their own; they only supply correlation signals.
  }
  return out;
}

/** Is this stake settled by the update? global CloseEvent, or a per-cid Settle for exactly this cid. */
function isSettledCid(ctx: HandleArchiveCtx, cid: string): boolean {
  return ctx.settle.global || ctx.settle.cids.has(cid);
}

interface HandleArchiveCtx {
  settle: { global: boolean; cids: Set<string> };
  allocReqCancel: boolean;
  stakedCreatesInUpdate: CreatedNode[];
}

// --- CREATE handlers: E1/E2, E4, E5/E7/E8/E9, E13, E15 ----------------------

function handleCreate(
  node: CreatedNode,
  state: ProjectorState,
  cfg: Config,
  out: Upsert[],
): void {
  const t = cfg.templates;
  const p = node.payload;

  // E1/E2 — Event create (first time = open; recreate with ended=true = ended).
  // cid-refresh: contract_id ALWAYS set to node.contractId.
  if (isTemplate(node, t.event)) {
    const eventId = asString(getField(p, 'eventId'));
    if (eventId === undefined) return;
    const ended = asBool(getField(p, 'ended')) ?? false;
    const existing = state.events.get(eventId);
    // once settled, never regress; otherwise open->ended by the ended flag.
    const status: 'open' | 'ended' | 'settled' =
      existing?.status === 'settled' ? 'settled' : ended ? 'ended' : 'open';
    out.push({
      op: 'upsertEvent',
      eventId,
      contractId: node.contractId, // E2: contract_id refreshed on the recreate
      organizerParty: asString(getField(p, 'organizer')) ?? '',
      title: asString(getField(p, 'title')) ?? '',
      stakeAmount: asDecimal(getField(p, 'stakeAmount')) ?? '0',
      instrumentAdmin: asString(getField(p, 'instrumentAdmin')) ?? '',
      instrumentId: asString(getField(p, 'instrumentId')) ?? '',
      rsvpDeadline: asString(getField(p, 'rsvpDeadline')) ?? '',
      eventEnd: asString(getField(p, 'eventEnd')) ?? '',
      settleBefore: asString(getField(p, 'settleBefore')) ?? '',
      status,
    });
    return;
  }

  // E4 — RSVPInvite create. cid-refresh: invite_cid.
  if (isTemplate(node, t.rsvpInvite)) {
    const eventId = asString(getField(p, 'eventId'));
    const attendeeParty = asString(getField(p, 'attendee'));
    const slotId = asString(getField(p, 'slotId'));
    if (eventId === undefined || attendeeParty === undefined || slotId === undefined) return;
    out.push({
      op: 'upsertRsvp',
      eventId,
      attendeeParty,
      slotId,
      inviteCid: node.contractId,
      status: 'invited',
    });
    return;
  }

  // E5/E7/E8/E9 — StakedRSVP create (every create carries the full payload; recreate = new cid).
  // cid-refresh: rsvp_cid ALWAYS set. Status derived from payload deltas.
  if (isTemplate(node, t.stakedRsvp)) {
    const s = readStaked(p);
    if (s === undefined) return;
    const prior = state.getRsvp({ eventId: s.eventId, attendeeParty: s.attendeeParty });

    let status:
      | 'accepted'
      | 'staked'
      | 'withdrawn'
      | undefined;
    if (s.withdrawn) {
      // E9 — withdrawn=true.
      status = 'withdrawn';
    } else if (s.allocationCid !== null || s.checkedIn) {
      // E7 — allocationCid = Some _ → stake locked. checkedIn also implies a
      // locked stake (Daml CheckIn asserts allocationCid /= None), which matters
      // when the poll-ACS Optional parse misses the cid on a check-in recreate:
      // without this, a stale terminal status (e.g. 'cancelled') survives while
      // the contract is demonstrably live + checked in.
      status = 'staked';
    } else if (
      prior === undefined ||
      prior.status === 'invited' ||
      prior.status === 'cancelled' ||
      prior.status === 'declined'
    ) {
      // E5 — a live StakedRSVP means the RSVP is active: fresh accept off an
      // invite, or a re-accept after a projected cancel/decline (self-healing —
      // a create for a row in a terminal state can only mean it's active again).
      status = 'accepted';
    }
    // E8 — checkedIn changed with no status transition: leave status as-is, just patch checked_in.

    out.push({
      op: 'patchRsvp',
      key: { eventId: s.eventId, attendeeParty: s.attendeeParty },
      set: {
        rsvpCid: node.contractId, // cid-refresh on EVERY recreate (E5,E7,E8,E9)
        ...(status !== undefined ? { status } : {}),
        // E9 clears allocation + check-in; otherwise reflect the payload value.
        allocationCid: s.withdrawn ? null : s.allocationCid,
        checkedIn: s.withdrawn ? false : s.checkedIn,
      },
    });
    return;
  }

  // E13 — TransferInstruction create, sender = pot → payout offered.
  // Gate on the interface VIEW's presence: the create's templateId is the concrete implementing
  // template (e.g. AmuletTransferInstruction), never the interface id, so template equality never
  // matches — the interface filter is what delivers this create + its view (F2).
  if (hasInterfaceView(node, t.transferInstruction) || isTemplate(node, t.transferInstruction)) {
    const view = node.interfaceViews?.[qn(t.transferInstruction)] ?? p;
    const leg = readTransferLeg(view);
    if (leg === undefined) return;
    if (leg.sender !== cfg.potParty) return; // only pot-out legs are payouts (E13 gate)

    const eventId = metaLookup(leg.meta, cfg.metaEventKey);
    if (eventId === undefined) {
      // meta stripped by the registry → unattributed log + alert (E13 fallback).
      out.push({
        op: 'insertPayoutUnattributed',
        transferCid: node.contractId,
        attendeeParty: leg.receiver,
        amount: leg.amount,
      });
      return;
    }
    out.push({
      op: 'insertPayout',
      eventId,
      attendeeParty: leg.receiver,
      amount: leg.amount,
      transferCid: node.contractId,
      status: 'offered',
    });
    return;
  }

  // E15 — pot-party Holding create → pot inflow. Matched by interface-view presence (F2).
  if (hasInterfaceView(node, t.holding) || isTemplate(node, t.holding)) {
    const view = node.interfaceViews?.[qn(t.holding)] ?? p;
    const h = readHolding(view);
    if (h === undefined) return;
    if (h.owner !== cfg.potParty) return; // only the pot's own Holdings are tracked
    out.push({
      op: 'upsertPotHolding',
      contractId: node.contractId,
      instrumentAdmin: h.instrumentAdmin,
      instrumentId: h.instrumentId,
      amount: h.amount,
    });
    return;
  }
}

// --- ARCHIVE handlers: E3, E6, E10/E11/E16, E12, E14, E15b ------------------

function handleArchive(
  node: ArchivedNode,
  u: LedgerUpdate,
  state: ProjectorState,
  cfg: Config,
  out: Upsert[],
  ctx: HandleArchiveCtx,
): void {
  const t = cfg.templates;
  const cid = node.contractId;

  // E3 — Event archived without recreate (MarkSettled) → settled.
  // If the same update recreated the Event (E2 EndEventEarly), the create node already refreshed the
  // row (status='ended', new cid). ProjectorState is only mutated post-commit, so eventByCid still
  // maps the OLD cid here — mirror the StakedRSVP recreate-skip and drop this archive when a same-update
  // Event create carries the same eventId, instead of relying on wire node ordering (F4).
  if (isTemplate(node, t.event)) {
    const eventId = state.eventByCid.get(cid);
    if (eventId === undefined) return; // stale cid from a recreate — the create already refreshed
    const recreatedInUpdate = creates(u).some(
      (c) => isTemplate(c, t.event) && asString(getField(c.payload, 'eventId')) === eventId,
    );
    if (recreatedInUpdate) return; // E2 recreate handled by the create side; don't clobber to 'settled'
    out.push({ op: 'setEventStatus', eventId, status: 'settled' });
    return;
  }

  // RSVPInvite archived — E5 (accepted, StakedRSVP created in same update) vs E6 (declined/revoked).
  if (isTemplate(node, t.rsvpInvite)) {
    const row = state.getRsvpByInviteCid(cid);
    if (row === undefined) return;
    // Was a StakedRSVP created in this update for this attendee? Then it's an accept (E5) and the
    // StakedRSVP create handler already set status='accepted' + rsvp_cid — do nothing here.
    const acceptedInUpdate = ctx.stakedCreatesInUpdate.some((c) => {
      const s = c.payload;
      return (
        asString(getField(s, 'eventId')) === row.eventId &&
        asString(getField(s, 'attendee')) === row.attendeeParty
      );
    });
    if (acceptedInUpdate) {
      // E5: the invite is consumed — clear invite_cid so the attendee UI never POSTs a dead cid (F8).
      // Status/rsvp_cid were already set by the StakedRSVP create handler.
      out.push({ op: 'patchRsvp', byInviteCid: cid, set: { inviteCid: null } });
      return;
    }
    // E6 — declined / revoked.
    out.push({ op: 'patchRsvp', byInviteCid: cid, set: { status: 'declined' } });
    return;
  }

  // StakedRSVP archived — E10 (settle) / E11 (cancel) / E16 (standard reject/withdraw).
  if (isTemplate(node, t.stakedRsvp)) {
    // If this update also RECREATES this StakedRSVP (E7/E8/E9), the archive is of the old cid in
    // a consuming-recreate. The create handler resolves by (eventId, attendeeParty) and already
    // refreshed rsvp_cid to the NEW cid; projecting the archive would need the row, so we detect
    // recreate by presence of a StakedRSVP create in the same update and skip.
    const recreatedInUpdate = ctx.stakedCreatesInUpdate.length > 0;
    const row = state.getRsvpByCid(cid);

    // E16 — archived via AllocationRequest_Reject/_Withdraw interface choice on this stake.
    if (ctx.allocReqCancel) {
      if (row === undefined) return;
      out.push({ op: 'patchRsvp', byRsvpCid: cid, set: { status: 'cancelled' } });
      return;
    }

    // A recreate consumes+creates in one update; the create side already advanced the row.
    if (recreatedInUpdate && row !== undefined) {
      // Confirm the recreate is for THIS row (same attendee); if so this archive is the old cid.
      const sameRow = ctx.stakedCreatesInUpdate.some((c) => {
        const s = c.payload;
        return (
          asString(getField(s, 'eventId')) === row.eventId &&
          asString(getField(s, 'attendee')) === row.attendeeParty
        );
      });
      if (sameRow) return; // handled by the create side (E7/E8/E9)
    }

    if (row === undefined) return;

    // E10 — archived as part of a settle (global CloseEvent-on-Event, or a per-cid Settle for THIS
    // stake) → settled. Per-cid keying stops one attendee's cancel window from settling others (F6).
    if (isSettledCid(ctx, cid)) {
      // Outcome from last-seen checked_in: true → refund, false → slash (06 §2 E10).
      const outcome: 'refund' | 'slash' = row.checkedIn ? 'refund' : 'slash';
      out.push({
        op: 'insertSettlement',
        eventId: row.eventId,
        attendeeParty: row.attendeeParty,
        outcome,
        amount: row.stakeAmount,
        updateId: u.updateId ?? u.offset, // polling fallback stores the ledger-end offset (06 §3)
      });
      out.push({ op: 'patchRsvp', byRsvpCid: cid, set: { status: 'settled' } });
      return;
    }

    // E11 — not E10, not a recreate → cancelled (CancelRSVP).
    out.push({ op: 'patchRsvp', byRsvpCid: cid, set: { status: 'cancelled' } });
    return;
  }

  // E12 — Allocation (interface) archived out-of-band (sender's Allocation_Withdraw) while its rsvps
  // row is still 'staked' → flag for the backend withdrawal watcher. Matched by the archived
  // template's implemented interfaces OR the stored allocation-cid mapping, since the wire templateId
  // is the concrete implementing template, not the interface id (F2).
  if (implementsInterface(node, t.allocation) || state.rsvpByAllocationCid.has(cid)) {
    const row = state.getRsvpByAllocationCid(cid);
    if (row === undefined) return;
    if (row.status !== 'staked') return;
    if (isSettledCid(ctx, row.rsvpCid ?? '') || ctx.settle.global) return; // settle consumes it legitimately
    // A cancel/settle also archives (or recreates) the StakedRSVP itself in the same update; a true
    // out-of-band withdrawal leaves the stake contract alive. If this row's own StakedRSVP is touched
    // here, it is NOT a withdrawal (avoids false withdrawal_detected on CancelRSVP's Allocation_Cancel).
    const rowKey = ProjectorStateKey(row.eventId, row.attendeeParty);
    const stakeTouched =
      ctx.stakedCreatesInUpdate.some(
        (c) =>
          asString(getField(c.payload, 'eventId')) === row.eventId &&
          asString(getField(c.payload, 'attendee')) === row.attendeeParty,
      ) ||
      u.nodes.some((n) => {
        if (n.kind !== 'archived' || !isTemplate(n, t.stakedRsvp)) return false;
        const r = state.getRsvpByCid(n.contractId);
        return r !== undefined && ProjectorStateKey(r.eventId, r.attendeeParty) === rowKey;
      });
    if (stakeTouched) return;
    out.push({
      op: 'patchRsvp',
      key: { eventId: row.eventId, attendeeParty: row.attendeeParty },
      set: { withdrawalDetected: true },
    });
    return;
  }

  // E14 — TransferInstruction archived after accept → payout completed. Keyed on transfer_cid, so it
  // is safe to attempt on any interface-matched (or otherwise unresolved) archive: the UPDATE simply
  // matches no row when the cid isn't a tracked payout (F2).
  if (implementsInterface(node, t.transferInstruction) || isTemplate(node, t.transferInstruction)) {
    out.push({ op: 'setPayoutAccepted', transferCid: cid });
    return;
  }

  // E15b — pot Holding archived → pot outflow (amount recalled from the stored row). The stored-cid
  // set is the reliable match; interface implementedInterfaces is a secondary signal (F2).
  if (state.potHoldings.has(cid) || implementsInterface(node, t.holding)) {
    if (!state.potHoldings.has(cid)) return; // matched interface but not a pot holding we track
    out.push({ op: 'deletePotHolding', contractId: cid });
    return;
  }
}

/** Stable string key for an rsvps row (mirrors ProjectorState.rsvpKey without importing the class). */
function ProjectorStateKey(eventId: string, attendeeParty: string): string {
  return `${eventId} ${attendeeParty}`;
}

// --- interface view readers -------------------------------------------------

function qn(q: QualifiedName): string {
  return `${q.module}:${q.entity}`;
}

interface TransferLeg {
  sender: string;
  receiver: string;
  amount: string;
  meta: unknown;
}

/**
 * Read the single transfer leg out of a TransferInstruction view. The token-standard view is
 * `TransferInstructionView { transfer = Transfer { sender, receiver, amount, instrumentId, ... },
 * meta }`. We tolerate a couple of nesting shapes.
 */
function readTransferLeg(view: Record<string, unknown>): TransferLeg | undefined {
  const transfer = (getField(view, 'transfer') as Record<string, unknown> | undefined) ?? view;
  const sender = asString(getField(transfer, 'sender'));
  const receiver = asString(getField(transfer, 'receiver'));
  const amount = asDecimal(getField(transfer, 'amount'));
  if (sender === undefined || receiver === undefined || amount === undefined) return undefined;
  // meta may live on the transfer or on the view.
  const meta = getField(transfer, 'meta') ?? getField(view, 'meta');
  return { sender, receiver, amount, meta };
}

interface HoldingFields {
  owner: string;
  instrumentAdmin: string;
  instrumentId: string;
  amount: string;
}

/**
 * Read a Holding view: `HoldingView { owner, instrumentId = InstrumentId { admin, id }, amount, ... }`.
 */
function readHolding(view: Record<string, unknown>): HoldingFields | undefined {
  const owner = asString(getField(view, 'owner'));
  const amount = asDecimal(getField(view, 'amount'));
  const instr = getField(view, 'instrumentId') as Record<string, unknown> | undefined;
  const instrumentAdmin = instr ? asString(getField(instr, 'admin')) : asString(getField(view, 'instrumentAdmin'));
  const instrumentId = instr ? asString(getField(instr, 'id')) : asString(getField(view, 'instrumentId'));
  if (owner === undefined || amount === undefined || instrumentAdmin === undefined || instrumentId === undefined) {
    return undefined;
  }
  return { owner, instrumentAdmin, instrumentId, amount };
}
