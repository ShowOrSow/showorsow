// Polling fallback feeder (06 §3), behind STREAM_MODE=poll.
//
// Polls POST /v2/state/active-contracts + the ledger end on a 2s tick and diffs against the
// previous snapshot to synthesize creates and archives. HONEST LIMITATIONS (06 §3):
//   (a) no update ids and no per-transaction grouping — settlements.update_id is filled with
//       the ledger-end offset instead (the column is nullable for exactly this reason);
//   (b) "same update" correlation (E5 vs E6, E10 vs E11) is approximated by "same diff window"
//       keyed on (event_id, attendee_party) — the diff of one tick is treated as one LedgerUpdate.
//
// Because a whole diff window is projected as a SINGLE synthetic LedgerUpdate, the exercise-node
// signals the handlers rely on (CloseEvent/Settle for E10, Reject/Withdraw for E16) are NOT
// available from ACS diffing. We reconstruct the minimum needed signal: if a StakedRSVP
// disappears in the same window that an Event flips to ended/settled OR its Allocation also
// disappears, we synthesize a Settle exercise node so E10 fires; otherwise it is treated as E11.
// This is the documented demo-scale approximation; the WS path is primary and exact.

import type { Config, QualifiedName } from './config.ts';
import type { LedgerUpdate, LedgerNode, CreatedNode } from './ledger-types.ts';
import { nameEq } from './ledger-types.ts';
import { decodeUpdate } from './decode.ts';
import { asString, asBool, getField } from './payload.ts';
import type { FeedHandle, FeedCallbacks } from './feed-ws.ts';

interface AcsEntry {
  node: CreatedNode;
}

async function httpJson(cfg: Config, path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.ledgerJwt) headers['Authorization'] = `Bearer ${cfg.ledgerJwt}`;
  const res = await fetch(`${cfg.ledgerHttpBase.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchLedgerEnd(cfg: Config): Promise<string> {
  const headers: Record<string, string> = {};
  if (cfg.ledgerJwt) headers['Authorization'] = `Bearer ${cfg.ledgerJwt}`;
  const res = await fetch(`${cfg.ledgerHttpBase.replace(/\/$/, '')}/v2/state/ledger-end`, { headers });
  if (!res.ok) throw new Error(`ledger-end -> ${res.status}`);
  const j = (await res.json()) as Record<string, unknown>;
  const off = j['offset'];
  return typeof off === 'string' || typeof off === 'number' ? String(off) : '0';
}

async function fetchAcs(cfg: Config, atOffset: string): Promise<Map<string, AcsEntry>> {
  // Wire filters need package-qualified interface ids (F2) — the bare
  // Module:Entity forms in cfg.templates are decode-side match names only.
  const ifaces = [cfg.interfaceWire.holding, cfg.interfaceWire.transferInstruction, cfg.interfaceWire.allocation].map(
    (interfaceId) => ({
      identifierFilter: {
        InterfaceFilter: { value: { interfaceId, includeInterfaceView: true } },
      },
    }),
  );
  const body = {
    activeAtOffset: atOffset,
    eventFormat: {
      filtersByParty: {
        [cfg.appOperatorParty]: {
          cumulative: [
            { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
            ...ifaces,
          ],
        },
      },
      verbose: true,
    },
  };
  const raw = await httpJson(cfg, '/v2/state/active-contracts', body);
  const list = Array.isArray(raw) ? raw : [];
  const map = new Map<string, AcsEntry>();
  for (const item of list) {
    // Each ACS item wraps a created event; reuse the update decoder on a synthetic 1-event txn.
    const synthetic = decodeUpdate({ offset: atOffset, events: [extractContractEntry(item)] });
    const node = synthetic?.nodes.find((n): n is CreatedNode => n.kind === 'created');
    if (node) map.set(node.contractId, { node });
  }
  return map;
}

function extractContractEntry(item: unknown): unknown {
  // active-contracts entries look like { contractEntry: { JsActiveContract: { createdEvent } } }
  // or { activeContract: { createdEvent } }; fall back to the item itself.
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    const nested =
      (o['contractEntry'] as Record<string, unknown> | undefined)?.['JsActiveContract'] ??
      (o['activeContract'] as Record<string, unknown> | undefined) ??
      o;
    if (nested && typeof nested === 'object') {
      const created = (nested as Record<string, unknown>)['createdEvent'];
      if (created) return { CreatedEvent: created };
    }
  }
  return item;
}

function isTpl(q: QualifiedName, target: QualifiedName): boolean {
  return nameEq(q, target);
}

function eventIdOf(node: CreatedNode): string | undefined {
  return asString(getField(node.payload, 'eventId'));
}

/** Build a create-only synthetic LedgerUpdate from an initial ACS snapshot (fresh-DB seed, F5). */
export function snapshotToUpdate(cfg: Config, snapshot: Map<string, AcsEntry>, offset: string): LedgerUpdate | undefined {
  const t = cfg.templates;
  const nodes: LedgerNode[] = [];
  // Events first — rsvps/settlements/payouts carry a FK to events(event_id) (07 §1); a single-txn
  // projection would abort if a child row were inserted before its event.
  for (const [, e] of snapshot) if (isTpl(e.node.templateId, t.event)) nodes.push(e.node);
  for (const [, e] of snapshot) if (!isTpl(e.node.templateId, t.event)) nodes.push(e.node);
  if (nodes.length === 0) return undefined;
  return { offset, nodes };
}

/** Build one synthetic LedgerUpdate from the diff between prev and next ACS snapshots. */
export function diffToUpdate(
  cfg: Config,
  prev: Map<string, AcsEntry>,
  next: Map<string, AcsEntry>,
  offset: string,
): LedgerUpdate | undefined {
  const nodes: LedgerNode[] = [];
  const t = cfg.templates;

  // Creates: in next, not in prev. Events first for the same FK-ordering reason as the seed.
  for (const [cid, e] of next) {
    if (!prev.has(cid) && isTpl(e.node.templateId, t.event)) nodes.push(e.node);
  }
  for (const [cid, e] of next) {
    if (!prev.has(cid) && !isTpl(e.node.templateId, t.event)) nodes.push(e.node);
  }

  // Which events ended/settled this window (by eventId)? Shows as an Event create with ended=true,
  // or an Event archive (MarkSettled). This is the ONLY reliable settle signal in the poll path —
  // a stake's allocation also vanishes on CancelRSVP, so "allocation gone" cannot distinguish a
  // settle from a cancel (F6). Keying settle on the event ending avoids that false positive.
  const endedEventIds = new Set<string>();
  for (const [cid, e] of next) {
    if (!prev.has(cid) && isTpl(e.node.templateId, t.event) && (asBool(getField(e.node.payload, 'ended')) ?? false)) {
      const id = eventIdOf(e.node);
      if (id) endedEventIds.add(id);
    }
  }
  for (const [cid, e] of prev) {
    if (!next.has(cid) && isTpl(e.node.templateId, t.event)) {
      const id = eventIdOf(e.node);
      if (id) endedEventIds.add(id);
    }
  }

  // Archives: in prev, not in next. For each archived StakedRSVP whose event ended/settled this
  // window, synthesize a PER-CID Settle exercise (choice 'Settle' on the stake's own cid) so E10
  // fires for exactly that row (06 §3 approximation, keyed per (event, attendee) — F6/F9).
  for (const [cid, e] of prev) {
    if (next.has(cid)) continue;
    nodes.push({ kind: 'archived', contractId: cid, templateId: e.node.templateId });
    if (isTpl(e.node.templateId, t.stakedRsvp)) {
      const evId = eventIdOf(e.node);
      if (evId !== undefined && endedEventIds.has(evId)) {
        nodes.push({
          kind: 'exercised',
          contractId: cid,
          templateId: t.stakedRsvp,
          choice: 'Settle',
          consuming: false,
        });
      }
    }
  }

  if (nodes.length === 0) return undefined;
  // No update id in the polling path — leave updateId undefined so E10 stores the offset (06 §3).
  return { offset, nodes };
}

export function startPollFeed(cfg: Config, cb: FeedCallbacks): FeedHandle {
  let stopped = false;
  let prev: Map<string, AcsEntry> | undefined;
  let timer: NodeJS.Timeout | undefined;

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      const end = await fetchLedgerEnd(cfg);
      const next = await fetchAcs(cfg, end);
      if (prev === undefined) {
        // First tick. If the DB has never been written (no indexer_state row → currentOffset
        // undefined), the pre-existing ACS was never projected — emit it as one create-only
        // synthetic update so events/rsvps rows exist before any later archive references them
        // (otherwise settlements/payouts FK inserts abort the whole update, F5). If the DB is already
        // caught up, just seed prev without emitting.
        if (cb.currentOffset() === undefined) {
          const seed = snapshotToUpdate(cfg, next, end);
          if (seed) await cb.onUpdate(seed);
        }
        prev = next;
      } else {
        const update = diffToUpdate(cfg, prev, next, end);
        if (update) await cb.onUpdate(update);
        prev = next;
      }
    } catch (e) {
      cb.onError?.(e);
    } finally {
      if (!stopped) timer = setTimeout(() => void tick(), cfg.pollIntervalMs);
    }
  }

  void tick();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
