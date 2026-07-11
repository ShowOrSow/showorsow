// GET /healthz -> { lastOffset, lagMs } (06 §5).
// The backend proxies this into GET /api/session for the frontend's StaleBadge.
//
// lagMs = wall-clock ms since the last update was projected. Before the first update it is
// null (indexer just started, nothing seen yet).

import { createServer } from 'node:http';
import type { Server } from 'node:http';

export interface HealthSource {
  getLastOffset(): string | undefined;
  /** epoch ms of the last successfully projected update, or undefined if none yet. */
  getLastUpdateAt(): number | undefined;
}

export function startHealthz(port: number, src: HealthSource): Server {
  const server = createServer((reqObj, res) => {
    if (reqObj.url && reqObj.url.split('?')[0] === '/healthz') {
      const lastAt = src.getLastUpdateAt();
      const body = JSON.stringify({
        lastOffset: src.getLastOffset() ?? null,
        lagMs: lastAt === undefined ? null : Date.now() - lastAt,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(port);
  return server;
}
