# ShowOrSow Indexer (TypeScript)

Subscribes to the JSON Ledger API v2 update stream **as `appOperator`** and projects contract
events into Neon/Postgres. **Read-only on the ledger — never submits a command.** If it dies, the
on-chain flow keeps working; dashboards just go stale (failure isolation). Spec: `plan/06-indexer.md`
(E1–E16 catalog is the contract), `plan/07-database.md` (DDL).

## Layout

| Path | Role |
|---|---|
| `migrations/001_init.sql` | Exact DDL from 07 §1 (all tables/types/view + indexes) |
| `src/config.ts` | Env config; template/interface identity by **qualified name** (package-id-agnostic) |
| `src/ledger-types.ts` | Normalized `LedgerUpdate` model (transport-agnostic) |
| `src/decode.ts` | Tolerant decoder: raw JSON API v2 envelopes → `LedgerUpdate` |
| `src/handlers.ts` | **E1–E16 as pure `(update, state, cfg) => Upsert[]` functions** |
| `src/upserts.ts` | Declarative DB-command model (handler output) |
| `src/state.ts` | In-memory last-seen snapshot the pure handlers read |
| `src/projector.ts` | Applies upserts + `indexer_state` advance in **one txn**; mutates state post-commit |
| `src/db.ts` | pg pool + startup hydration of `ProjectorState` |
| `src/feed-ws.ts` | Primary feeder: updates WebSocket, begin-offset from `indexer_state` |
| `src/feed-poll.ts` | Fallback feeder: active-contracts diffing (`STREAM_MODE=poll`, 06 §3) |
| `src/healthz.ts` | `GET /healthz` → `{ lastOffset, lagMs }` |
| `src/migrate.ts` | Idempotent migration runner |
| `src/main.ts` | Wiring / entrypoint |

## Load-bearing rules implemented

- **Exactly-once (06 §1):** each update's projections + `indexer_state.last_offset` advance in one
  DB transaction; `settlements`/`payouts`/`payouts_unattributed` inserts are `ON CONFLICT DO NOTHING`
  → replay from any offset (incl. 0) is safe.
- **cid-refresh (06 §1):** every create overwrites the row's current-cid column
  (`events.contract_id`; `rsvps.rsvp_cid` on every `StakedRSVP` recreate E5/E7/E8/E9; `invite_cid`;
  `payouts.transfer_cid`). Archive handlers resolve rows by that stored cid.
- **E10 vs E11:** a `StakedRSVP` archive is a settlement **only** if a `CloseEvent`/`Settle` exercise
  node is present in the same update; outcome (`refund`/`slash`) is read from last-seen `checked_in`.
- **E13:** `event_id` from transfer `meta["showorsow.dev/event"]`; missing meta → `payouts_unattributed`.
- **E15/E15b:** pot-party `Holding` creates/archives tracked in `pot_holdings` (amount recalled from
  the stored row on archive, since archives carry no payload); `pot_balances` is a SUM view.

## Run

```bash
pnpm install
cp .env.example .env            # fill DATABASE_URL, APP_OPERATOR_PARTY, ledger endpoints
pnpm migrate                    # apply migrations/*.sql
pnpm exec tsc --noEmit          # typecheck (must be clean)
pnpm test                       # unit tests (node:test)
pnpm dev                        # run from source (Node 22 --experimental-strip-types)
# or: pnpm build && pnpm start
```

`STREAM_MODE=ws` (default, primary) or `poll` (active-contracts fallback, 06 §3).
