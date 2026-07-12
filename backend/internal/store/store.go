// Package store is the Neon (Postgres/pgx) access layer. The backend WRITES
// only event_meta + balance_snapshots (07 §2); everything else it READS from
// the indexer-owned read model.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store wraps a pgx pool.
type Store struct {
	pool *pgxpool.Pool
}

// ErrNotFound is returned when a single-row read finds nothing.
var ErrNotFound = errors.New("not found")

// New opens a pgx pool against the Neon connection string.
func New(ctx context.Context, dsn string) (*Store, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	return &Store{pool: pool}, nil
}

// Close releases the pool.
func (s *Store) Close() { s.pool.Close() }

// Pool exposes the underlying pgx pool so the users package (07 §2 backend
// writer of the `users` table) can share this single connection pool.
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Ping verifies connectivity.
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

// ---- backend-written tables ----

// EventMeta is the off-chain descriptive record for an event.
type EventMeta struct {
	EventID     string
	Description string
	Venue       string
	ImageURL    string
}

// WriteEventMeta upserts an event_meta row. Written before the indexer lands
// the events row; the §3 joins are LEFT JOIN and self-heal (07 §1).
func (s *Store) WriteEventMeta(ctx context.Context, m EventMeta) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO event_meta (event_id, description, venue, image_url)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (event_id) DO UPDATE
		  SET description = EXCLUDED.description,
		      venue       = EXCLUDED.venue,
		      image_url   = EXCLUDED.image_url`,
		m.EventID, m.Description, m.Venue, m.ImageURL)
	return err
}

// SnapshotPhase is the enum snapshot_phase.
type SnapshotPhase string

const (
	PhaseBefore SnapshotPhase = "before"
	PhaseAfter  SnapshotPhase = "after"
)

// BalanceSnapshot is one row of balance_snapshots (05 §6).
type BalanceSnapshot struct {
	EventID      string
	Party        string
	Phase        SnapshotPhase
	InstrumentID string
	Amount       string // numeric as string to preserve exact scale
}

// WriteBalanceSnapshot upserts one snapshot row (PK: event,party,phase,instrument).
func (s *Store) WriteBalanceSnapshot(ctx context.Context, b BalanceSnapshot) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO balance_snapshots (event_id, party, phase, instrument_id, amount)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (event_id, party, phase, instrument_id) DO UPDATE
		  SET amount = EXCLUDED.amount, taken_at = now()`,
		b.EventID, b.Party, string(b.Phase), b.InstrumentID, b.Amount)
	return err
}

// ---- read-model reads (07 §3) ----

// EventRow is the projected events row joined with event_meta.
type EventRow struct {
	EventID         string
	ContractID      string
	OrganizerParty  string
	Title           string
	StakeAmount     string
	InstrumentAdmin string
	InstrumentID    string
	RSVPDeadline    time.Time
	EventEnd        time.Time
	SettleBefore    time.Time
	Status          string
	// meta (LEFT JOIN, may be empty)
	Description string
	Venue       string
	ImageURL    string
}

// GetEvent reads a single events ⋈ event_meta row by event_id.
func (s *Store) GetEvent(ctx context.Context, eventID string) (*EventRow, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT e.event_id, e.contract_id, e.organizer_party, e.title,
		       e.stake_amount::text, e.instrument_admin, e.instrument_id,
		       e.rsvp_deadline, e.event_end, e.settle_before, e.status::text,
		       COALESCE(m.description,''), COALESCE(m.venue,''), COALESCE(m.image_url,'')
		FROM events e
		LEFT JOIN event_meta m ON m.event_id = e.event_id
		WHERE e.event_id = $1`, eventID)
	var e EventRow
	err := row.Scan(&e.EventID, &e.ContractID, &e.OrganizerParty, &e.Title,
		&e.StakeAmount, &e.InstrumentAdmin, &e.InstrumentID,
		&e.RSVPDeadline, &e.EventEnd, &e.SettleBefore, &e.Status,
		&e.Description, &e.Venue, &e.ImageURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

// ListEventsForOrganizer returns events owned by an organizer party, ordered by
// event_end (07 §3).
func (s *Store) ListEventsForOrganizer(ctx context.Context, organizerParty string) ([]EventRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.event_id, e.contract_id, e.organizer_party, e.title,
		       e.stake_amount::text, e.instrument_admin, e.instrument_id,
		       e.rsvp_deadline, e.event_end, e.settle_before, e.status::text,
		       COALESCE(m.description,''), COALESCE(m.venue,''), COALESCE(m.image_url,'')
		FROM events e
		LEFT JOIN event_meta m ON m.event_id = e.event_id
		WHERE e.organizer_party = $1
		ORDER BY e.event_end`, organizerParty)
	if err != nil {
		return nil, err
	}
	return scanEventRows(rows)
}

// ListEventsForAttendee returns only events where the attendee holds an rsvps
// row (07 §3), ordered by event_end.
func (s *Store) ListEventsForAttendee(ctx context.Context, attendeeParty string) ([]EventRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.event_id, e.contract_id, e.organizer_party, e.title,
		       e.stake_amount::text, e.instrument_admin, e.instrument_id,
		       e.rsvp_deadline, e.event_end, e.settle_before, e.status::text,
		       COALESCE(m.description,''), COALESCE(m.venue,''), COALESCE(m.image_url,'')
		FROM events e
		JOIN rsvps r ON r.event_id = e.event_id AND r.attendee_party = $1
		LEFT JOIN event_meta m ON m.event_id = e.event_id
		ORDER BY e.event_end`, attendeeParty)
	if err != nil {
		return nil, err
	}
	return scanEventRows(rows)
}

// ListEventsForUser returns every event a user can see: events they organize
// (organizer_party = their party) UNION events where they hold an rsvps row
// (07 §3). Under real accounts a single user is both an organizer of their own
// events and an attendee of others, so the list is the union. Ordered by
// event_end.
func (s *Store) ListEventsForUser(ctx context.Context, party string) ([]EventRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT e.event_id, e.contract_id, e.organizer_party, e.title,
		       e.stake_amount::text, e.instrument_admin, e.instrument_id,
		       e.rsvp_deadline, e.event_end, e.settle_before, e.status::text,
		       COALESCE(m.description,''), COALESCE(m.venue,''), COALESCE(m.image_url,'')
		FROM events e
		LEFT JOIN event_meta m ON m.event_id = e.event_id
		WHERE e.organizer_party = $1
		   OR EXISTS (SELECT 1 FROM rsvps r
		              WHERE r.event_id = e.event_id AND r.attendee_party = $1)
		ORDER BY e.event_end`, party)
	if err != nil {
		return nil, err
	}
	return scanEventRows(rows)
}

func scanEventRows(rows pgx.Rows) ([]EventRow, error) {
	defer rows.Close()
	var out []EventRow
	for rows.Next() {
		var e EventRow
		if err := rows.Scan(&e.EventID, &e.ContractID, &e.OrganizerParty, &e.Title,
			&e.StakeAmount, &e.InstrumentAdmin, &e.InstrumentID,
			&e.RSVPDeadline, &e.EventEnd, &e.SettleBefore, &e.Status,
			&e.Description, &e.Venue, &e.ImageURL); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// RSVPRow is a projected rsvps row.
type RSVPRow struct {
	EventID            string
	AttendeeParty      string
	SlotID             string
	InviteCID          string
	RSVPCID            string
	AllocationCID      string
	Status             string
	CheckedIn          bool
	WithdrawalDetected bool
}

// GetRSVP reads a single rsvps row by (event, attendee).
func (s *Store) GetRSVP(ctx context.Context, eventID, attendeeParty string) (*RSVPRow, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT event_id, attendee_party, slot_id,
		       COALESCE(invite_cid,''), COALESCE(rsvp_cid,''), COALESCE(allocation_cid,''),
		       status::text, checked_in, withdrawal_detected
		FROM rsvps WHERE event_id = $1 AND attendee_party = $2`, eventID, attendeeParty)
	r, err := scanRSVP(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return r, err
}

// GetRSVPByCid reads a single rsvps row by its current rsvp_cid.
func (s *Store) GetRSVPByCid(ctx context.Context, rsvpCid string) (*RSVPRow, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT event_id, attendee_party, slot_id,
		       COALESCE(invite_cid,''), COALESCE(rsvp_cid,''), COALESCE(allocation_cid,''),
		       status::text, checked_in, withdrawal_detected
		FROM rsvps WHERE rsvp_cid = $1`, rsvpCid)
	r, err := scanRSVP(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return r, err
}

// GetRSVPByInviteCid reads a single rsvps row by its invite_cid.
func (s *Store) GetRSVPByInviteCid(ctx context.Context, inviteCid string) (*RSVPRow, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT event_id, attendee_party, slot_id,
		       COALESCE(invite_cid,''), COALESCE(rsvp_cid,''), COALESCE(allocation_cid,''),
		       status::text, checked_in, withdrawal_detected
		FROM rsvps WHERE invite_cid = $1`, inviteCid)
	r, err := scanRSVP(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return r, err
}

type scannable interface {
	Scan(dest ...any) error
}

func scanRSVP(row scannable) (*RSVPRow, error) {
	var r RSVPRow
	err := row.Scan(&r.EventID, &r.AttendeeParty, &r.SlotID,
		&r.InviteCID, &r.RSVPCID, &r.AllocationCID,
		&r.Status, &r.CheckedIn, &r.WithdrawalDetected)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ListRSVPsForEvent returns all rsvps rows for an event (organizer view).
func (s *Store) ListRSVPsForEvent(ctx context.Context, eventID string) ([]RSVPRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT event_id, attendee_party, slot_id,
		       COALESCE(invite_cid,''), COALESCE(rsvp_cid,''), COALESCE(allocation_cid,''),
		       status::text, checked_in, withdrawal_detected
		FROM rsvps WHERE event_id = $1
		ORDER BY slot_id`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RSVPRow
	for rows.Next() {
		r, err := scanRSVP(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *r)
	}
	return out, rows.Err()
}

// EventStats is the organizer stats block (07 §3).
type EventStats struct {
	Headcount      int
	CheckedInCount int
	TVL            string
	PotBalance     string
}

// GetEventStats computes headcount / checkedInCount / TVL / potBalance.
// headcount = count staked; checkedIn = staked AND checked_in; TVL = headcount ×
// stake_amount; potBalance from the pot_balances view for this instrument.
func (s *Store) GetEventStats(ctx context.Context, eventID string) (*EventStats, error) {
	var st EventStats
	err := s.pool.QueryRow(ctx, `
		WITH ev AS (SELECT stake_amount, instrument_admin, instrument_id FROM events WHERE event_id = $1),
		     hc AS (
		       SELECT
		         count(*) FILTER (WHERE status = 'staked')                     AS headcount,
		         count(*) FILTER (WHERE status = 'staked' AND checked_in)      AS checked_in
		       FROM rsvps WHERE event_id = $1
		     )
		SELECT hc.headcount,
		       hc.checked_in,
		       (hc.headcount * (SELECT stake_amount FROM ev))::text AS tvl,
		       COALESCE((
		         SELECT balance::text FROM pot_balances pb, ev
		         WHERE pb.instrument_admin = ev.instrument_admin
		           AND pb.instrument_id   = ev.instrument_id
		       ), '0') AS pot
		FROM hc`, eventID).Scan(&st.Headcount, &st.CheckedInCount, &st.TVL, &st.PotBalance)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// SettlementRow joins settlements ⋈ payouts ⋈ rsvps ⋈ balance_snapshots per
// attendee (the full web-pinned settlement package, 05 §2).
type SettlementRow struct {
	AttendeeParty string
	Outcome       string
	Amount        string
	PayoutAmount  string
	PayoutStatus  string
	UpdateID      string
	CheckedIn     bool
	BalanceBefore string
	BalanceAfter  string
	InstrumentID  string
}

// GetSettlementPackage returns the settlement rows for an event (07 §3).
func (s *Store) GetSettlementPackage(ctx context.Context, eventID string) ([]SettlementRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.attendee_party,
		       s.outcome::text,
		       s.amount::text,
		       COALESCE(p.amount, 0)::text                AS payout_amount,
		       COALESCE(p.status::text, '')               AS payout_status,
		       COALESCE(s.update_id, '')                  AS update_id,
		       COALESCE(rv.checked_in, false)             AS checked_in,
		       COALESCE(bb.amount, 0)::text               AS balance_before,
		       COALESCE(ba.amount, 0)::text               AS balance_after,
		       COALESCE(bb.instrument_id, ba.instrument_id, '') AS instrument_id
		FROM settlements s
		LEFT JOIN payouts p
		       ON p.event_id = s.event_id AND p.attendee_party = s.attendee_party
		LEFT JOIN rsvps rv
		       ON rv.event_id = s.event_id AND rv.attendee_party = s.attendee_party
		LEFT JOIN balance_snapshots bb
		       ON bb.event_id = s.event_id AND bb.party = s.attendee_party AND bb.phase = 'before'
		LEFT JOIN balance_snapshots ba
		       ON ba.event_id = s.event_id AND ba.party = s.attendee_party AND ba.phase = 'after'
		WHERE s.event_id = $1
		ORDER BY s.attendee_party`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SettlementRow
	for rows.Next() {
		var r SettlementRow
		if err := rows.Scan(&r.AttendeeParty, &r.Outcome, &r.Amount,
			&r.PayoutAmount, &r.PayoutStatus, &r.UpdateID, &r.CheckedIn,
			&r.BalanceBefore, &r.BalanceAfter, &r.InstrumentID); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// BalanceDeltaRow is one delta row (before → after) for the delta panel.
type BalanceDeltaRow struct {
	Party        string
	InstrumentID string
	Before       string
	After        string
}

// GetBalanceDeltas returns before/after snapshot pairs per party for an event.
func (s *Store) GetBalanceDeltas(ctx context.Context, eventID string) ([]BalanceDeltaRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT COALESCE(bb.party, ba.party)                 AS party,
		       COALESCE(bb.instrument_id, ba.instrument_id) AS instrument_id,
		       COALESCE(bb.amount, 0)::text                 AS before_amt,
		       COALESCE(ba.amount, 0)::text                 AS after_amt
		FROM (SELECT * FROM balance_snapshots WHERE event_id = $1 AND phase = 'before') bb
		FULL OUTER JOIN (SELECT * FROM balance_snapshots WHERE event_id = $1 AND phase = 'after') ba
		  ON bb.party = ba.party AND bb.instrument_id = ba.instrument_id
		ORDER BY party`, eventID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BalanceDeltaRow
	for rows.Next() {
		var d BalanceDeltaRow
		if err := rows.Scan(&d.Party, &d.InstrumentID, &d.Before, &d.After); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ListUserParties returns every registered user's Canton party id. The deposit
// acceptor watcher (05 §6b) sweeps these as the set of receiver parties whose
// pending TransferInstructions it accepts. Empty party ids are excluded.
func (s *Store) ListUserParties(ctx context.Context) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT party_id FROM users WHERE party_id <> '' ORDER BY party_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ---- withdrawal watcher query (05 §7) ----

// WithdrawalCandidate is a staked RSVP flagged for withdrawal.
type WithdrawalCandidate struct {
	EventID       string
	AttendeeParty string
	RSVPCID       string
	AllocationCID string
}

// ListWithdrawalCandidates returns staked RSVPs with withdrawal_detected set
// (05 §7). Idempotent: once MarkWithdrawn flips status to 'withdrawn' the row
// drops out of this query.
func (s *Store) ListWithdrawalCandidates(ctx context.Context) ([]WithdrawalCandidate, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT event_id, attendee_party, COALESCE(rsvp_cid,''), COALESCE(allocation_cid,'')
		FROM rsvps
		WHERE withdrawal_detected AND status = 'staked'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WithdrawalCandidate
	for rows.Next() {
		var w WithdrawalCandidate
		if err := rows.Scan(&w.EventID, &w.AttendeeParty, &w.RSVPCID, &w.AllocationCID); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
