// Indexer entrypoint. Read-only on the ledger — never submits a command (06 header).
//
// Wiring:
//   loadConfig -> makePool -> readLastOffset + hydrateState -> Projector
//   -> start healthz -> start the WS (primary) or poll (fallback) feeder
//   -> each update is projected atomically (upserts + indexer_state advance in one txn).

import { loadConfig } from './config.ts';
import { makePool, readLastOffset, hydrateState } from './db.ts';
import { Projector } from './projector.ts';
import { startHealthz } from './healthz.ts';
import { startWsFeed } from './feed-ws.ts';
import { startPollFeed } from './feed-poll.ts';
import type { FeedHandle, FeedCallbacks } from './feed-ws.ts';
import type { LedgerUpdate } from './ledger-types.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pool = makePool(cfg.databaseUrl);

  const initialOffset = await readLastOffset(pool);
  const state = await hydrateState(pool);
  const projector = new Projector(pool, cfg, state, initialOffset);

  let lastUpdateAt: number | undefined;

  const health = startHealthz(cfg.healthzPort, {
    getLastOffset: () => projector.getLastOffset(),
    getLastUpdateAt: () => lastUpdateAt,
  });

  const callbacks: FeedCallbacks = {
    async onUpdate(u: LedgerUpdate): Promise<void> {
      await projector.apply(u);
      lastUpdateAt = Date.now();
    },
    // Idle ledger ≠ stale indexer: a successful no-op poll also counts as fresh,
    // otherwise the frontend's "data syncing…" badge sticks on quiet periods.
    onSynced: () => {
      lastUpdateAt = Date.now();
    },
    currentOffset: () => projector.getLastOffset(),
    onError: (e) => {
      console.error('[feed] error:', e instanceof Error ? e.message : e);
    },
  };

  const feed: FeedHandle =
    cfg.streamMode === 'poll' ? startPollFeed(cfg, callbacks) : startWsFeed(cfg, callbacks);

  console.log(
    `[indexer] started mode=${cfg.streamMode} beginOffset=${initialOffset ?? '(ledger begin)'} ` +
      `healthz=:${cfg.healthzPort} party=${cfg.appOperatorParty}`,
  );

  const shutdown = async (): Promise<void> => {
    console.log('[indexer] shutting down');
    feed.stop();
    health.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((e) => {
  console.error('[indexer] fatal:', e);
  process.exit(1);
});
