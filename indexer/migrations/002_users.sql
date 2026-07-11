-- 002: Luma-style user accounts (backend-written table; indexer never touches it).
-- Signup allocates a Canton party per user (POST /v2/parties); party_id is the
-- user's on-ledger identity. See plan/05-backend.md §2 and plan/07-database.md.

CREATE TABLE IF NOT EXISTS users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  party_id      text NOT NULL UNIQUE,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_party_idx ON users (party_id);
