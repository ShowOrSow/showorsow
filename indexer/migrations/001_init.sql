-- ShowOrSow read model — DDL from plan/07-database.md §1 (verbatim).
-- Writer: indexer only (events, rsvps, settlements, payouts, payouts_unattributed,
-- pot_holdings, indexer_state). event_meta / balance_snapshots are backend-written and
-- are included here so a fresh DB has the full schema.

-- ledger projections (writer: indexer)

CREATE TYPE event_status AS ENUM ('open','ended','settled');
CREATE TABLE events (
  event_id         text PRIMARY KEY,          -- ShowOrSow eventId (UUID), NOT contract id
  contract_id      text NOT NULL,             -- CURRENT Event cid; refreshed on every recreate (E2)
  organizer_party  text NOT NULL,
  title            text NOT NULL,
  stake_amount     numeric NOT NULL,          -- unconstrained scale (display scale from /api/tokens)
  instrument_admin text NOT NULL,
  instrument_id    text NOT NULL,             -- 'CBTC' / 'cETH' — case-sensitive, opaque
  rsvp_deadline    timestamptz NOT NULL,
  event_end        timestamptz NOT NULL,
  settle_before    timestamptz NOT NULL,
  status           event_status NOT NULL DEFAULT 'open',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE rsvp_status AS ENUM
  ('invited','declined','accepted','staked','withdrawn','cancelled','settled');
CREATE TABLE rsvps (
  event_id        text NOT NULL REFERENCES events(event_id),
  attendee_party  text NOT NULL,
  slot_id         text NOT NULL,
  invite_cid      text,                       -- refreshed on create (E4)
  rsvp_cid        text,                       -- CURRENT StakedRSVP cid; refreshed on EVERY recreate
  allocation_cid  text,
  status          rsvp_status NOT NULL DEFAULT 'invited',
  checked_in      boolean NOT NULL DEFAULT false,
  withdrawal_detected boolean NOT NULL DEFAULT false,  -- E12; backend watcher -> MarkWithdrawn
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, attendee_party)
);

CREATE TYPE settle_outcome AS ENUM ('refund','slash');
CREATE TABLE settlements (
  id              bigserial PRIMARY KEY,
  event_id        text NOT NULL REFERENCES events(event_id),
  attendee_party  text NOT NULL,
  outcome         settle_outcome NOT NULL,
  amount          numeric NOT NULL,
  update_id       text,                       -- nullable: polling fallback has no update ids
  settled_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, attendee_party)           -- inserts are ON CONFLICT DO NOTHING (replay-safe)
);

CREATE TYPE payout_status AS ENUM ('offered','accepted');
CREATE TABLE payouts (
  id              bigserial PRIMARY KEY,
  event_id        text NOT NULL REFERENCES events(event_id),  -- from transfer meta stamp (E13)
  attendee_party  text NOT NULL,
  amount          numeric NOT NULL,
  transfer_cid    text NOT NULL,
  status          payout_status NOT NULL DEFAULT 'offered',
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transfer_cid)                        -- ON CONFLICT DO NOTHING
);

CREATE TABLE payouts_unattributed (             -- E13 fallback if registry strips meta (alert!)
  transfer_cid    text PRIMARY KEY,
  attendee_party  text NOT NULL,
  amount          numeric NOT NULL,
  seen_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pot_holdings (                     -- per-Holding tracking: archives carry no payload,
  contract_id      text PRIMARY KEY,            -- so amounts must be remembered from creates (E15)
  instrument_admin text NOT NULL,
  instrument_id    text NOT NULL,
  amount           numeric NOT NULL
);
-- pot_balances is a VIEW, not a table:
CREATE VIEW pot_balances AS
  SELECT instrument_admin, instrument_id, SUM(amount) AS balance
  FROM pot_holdings GROUP BY 1, 2;

CREATE TABLE indexer_state (
  id           int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_offset  text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- INVARIANT: last_offset advances in the SAME transaction as that update's projections (06 §1)

-- off-chain store (writer: backend)

CREATE TABLE event_meta (
  event_id     text PRIMARY KEY,               -- NO FK: meta written before indexer lands events row
  description  text,
  venue        text,
  image_url    text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE snapshot_phase AS ENUM ('before','after');
CREATE TABLE balance_snapshots (                -- written by backend settlement runner (05 §6)
  event_id     text NOT NULL,
  party        text NOT NULL,
  phase        snapshot_phase NOT NULL,
  instrument_id text NOT NULL,
  amount       numeric NOT NULL,
  taken_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, party, phase, instrument_id)
);

-- Indexes (07 §1)
CREATE INDEX idx_rsvps_event_id ON rsvps(event_id);
CREATE INDEX idx_rsvps_attendee_party ON rsvps(attendee_party);
CREATE INDEX idx_settlements_event_id ON settlements(event_id);
CREATE INDEX idx_payouts_event_id ON payouts(event_id);
