// Primary stream feeder: JSON Ledger API v2 updates WebSocket (AsyncAPI), as appOperator.
//
// Subscribes from indexer_state.last_offset (begin offset). Each received transaction envelope
// is decoded and handed to onUpdate one at a time, in order. The caller (main) projects each
// update atomically. On socket close/error we reconnect with backoff, resuming from the last
// committed offset (exactly-once holds because the projector is idempotent, 06 §1).
//
// The subscription request shape is JSON API v2's GetUpdates: a transaction filter selecting
// appOperator's visibility, plus interface filters (includeInterfaceView) so Holding /
// TransferInstruction / Allocation views arrive on creates (04 §3). We keep the request generic
// and match identity by qualified name in the decoder — package ids are not pinned here.

import { WebSocket } from 'ws';
import type { Config } from './config.ts';
import type { LedgerUpdate } from './ledger-types.ts';
import { decodeUpdate } from './decode.ts';

export interface FeedHandle {
  stop(): void;
}

export interface FeedCallbacks {
  onUpdate(u: LedgerUpdate): Promise<void>;
  /** Called when the feeder needs the current begin offset (after reconnect). */
  currentOffset(): string | undefined;
  /** Called after each successful sync with the ledger, even when no updates
   *  arrived (a poll tick that found nothing new). Lets healthz report
   *  "caught up" instead of ever-growing lag on an idle ledger. */
  onSynced?(): void;
  onError?(e: unknown): void;
}

function buildSubscribeMessage(cfg: Config, beginOffset: string | undefined): string {
  // Interface filters so token-standard views arrive with creates. The InterfaceFilter needs a
  // package-qualified WIRE id (04 §2), NOT the bare module:entity match name (F2).
  const ifaceWireIds = [
    cfg.interfaceWire.holding,
    cfg.interfaceWire.transferInstruction,
    cfg.interfaceWire.allocation,
  ];
  // JSON API v2 GetUpdatesRequest (wildcard template filter for appOperator's own visibility +
  // interface views). beginExclusive omitted => from ledger begin (offset 0) on a fresh DB.
  //
  // transactionShape MUST be TRANSACTION_SHAPE_LEDGER_EFFECTS: ACS_DELTA carries only created +
  // archived events, never the ExercisedEvents that E10/E16/E12 correlation depends on (F1). Under
  // LEDGER_EFFECTS archives are delivered as consuming exercises — decode.ts synthesizes the
  // ArchivedNode so the handlers still see an archive.
  const msg: Record<string, unknown> = {
    updateFormat: {
      includeTransactions: {
        eventFormat: {
          filtersByParty: {
            [cfg.appOperatorParty]: {
              cumulative: [
                { identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } },
                ...ifaceWireIds.map((interfaceId) => ({
                  identifierFilter: {
                    InterfaceFilter: {
                      value: { interfaceId, includeInterfaceView: true },
                    },
                  },
                })),
              ],
            },
          },
          verbose: true,
        },
        transactionShape: 'TRANSACTION_SHAPE_LEDGER_EFFECTS',
      },
    },
  };
  if (beginOffset !== undefined) {
    (msg as Record<string, unknown>)['beginExclusive'] = beginOffset;
  }
  return JSON.stringify(msg);
}

export function startWsFeed(cfg: Config, cb: FeedCallbacks): FeedHandle {
  let stopped = false;
  let ws: WebSocket | undefined;
  let backoff = 500;
  const maxBackoff = 15_000;

  // Universal update stream (3.4+). /v2/updates/flats and /trees are deprecated and removed in 3.5.
  const url = `${cfg.ledgerWsBase.replace(/\/$/, '')}/v2/updates`;

  function connect(): void {
    if (stopped) return;
    const headers: Record<string, string> = {};
    if (cfg.ledgerJwt) headers['Authorization'] = `Bearer ${cfg.ledgerJwt}`;
    ws = new WebSocket(url, { headers });

    ws.on('open', () => {
      backoff = 500;
      halted = false; // fresh subscription resumes from the last committed offset
      ws?.send(buildSubscribeMessage(cfg, cb.currentOffset()));
    });

    ws.on('message', (data) => {
      void handleMessage(data.toString());
    });

    ws.on('error', (e) => {
      cb.onError?.(e);
    });

    ws.on('close', () => {
      if (stopped) return;
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, maxBackoff);
    });
  }

  // Serialize projection: never overlap two onUpdate calls (offset ordering must hold).
  let chain: Promise<void> = Promise.resolve();
  // Once a projection fails we must NOT advance the offset past it (exactly-once, 06 §1/F3): stop
  // processing and drop the socket. The reconnect path resubscribes from the last committed offset
  // (currentOffset), and idempotent replay (ON CONFLICT DO NOTHING) makes the retry safe.
  let halted = false;
  async function handleMessage(text: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // non-JSON frame (ping) — ignore
    }
    // A stream frame may batch multiple update envelopes into a JSON array (F7): decode each in order.
    const raws = Array.isArray(parsed) ? parsed : [parsed];
    for (const raw of raws) {
      const update = decodeUpdate(raw);
      if (!update) continue; // heartbeat / non-transaction envelope
      chain = chain.then(async () => {
        if (halted) return;
        try {
          await cb.onUpdate(update);
        } catch (e) {
          halted = true;
          cb.onError?.(e);
          ws?.close(); // reconnect resumes from the last committed offset; do NOT advance past this update
        }
      });
    }
    await chain;
  }

  connect();

  return {
    stop(): void {
      stopped = true;
      ws?.close();
    },
  };
}
