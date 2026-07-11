// Package users is the Luma-style account layer (pivot Jul 11, replaces the
// persona switcher, 05 §2). Every registered user gets their own Canton party,
// allocated at signup via the JSON Ledger API (POST /v2/parties). It owns the
// backend-written `users` table (07 §2): CRUD with bcrypt password hashing plus
// party allocation and idempotent demo seeding.
package users

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// Sentinel errors surfaced to the API layer for status mapping.
var (
	// ErrNotFound is returned when no user matches the lookup key.
	ErrNotFound = errors.New("user not found")
	// ErrEmailTaken is returned when registering an already-registered email.
	ErrEmailTaken = errors.New("email already registered")
	// ErrInvalidCredentials is returned on a failed login (unknown email OR
	// wrong password — deliberately indistinguishable, no account enumeration).
	ErrInvalidCredentials = errors.New("invalid email or password")
	// ErrNotDemo is returned when dev-login targets a non-demo account.
	ErrNotDemo = errors.New("not a demo account")
)

// User is one row of the users table (password hash never leaves the package).
type User struct {
	ID          int64
	Email       string
	DisplayName string
	PartyID     string
	IsDemo      bool
}

// Allocator allocates a fresh Canton party. Satisfied by *ledger.Client
// (AllocateParty). actAsParty authorises the /v2/parties call (appOperator on
// LocalNet/DevNet; ignored on the unauthenticated sandbox).
type Allocator interface {
	AllocateParty(ctx context.Context, actAsParty, hint string) (string, error)
}

// Manager provides user CRUD, authentication, and party allocation.
type Manager struct {
	pool             *pgxpool.Pool
	alloc            Allocator
	appOperatorParty string // authorises party allocation

	mu         sync.RWMutex
	labelCache map[string]string // party_id → display name (immutable per party)
}

// New builds a users Manager over a pgx pool and a party Allocator.
func New(pool *pgxpool.Pool, alloc Allocator, appOperatorParty string) *Manager {
	return &Manager{
		pool:             pool,
		alloc:            alloc,
		appOperatorParty: appOperatorParty,
		labelCache:       map[string]string{},
	}
}

// Register creates a new account: bcrypt-hashes the password, allocates a
// Canton party (partyIdHint = slug(email-local) + short random suffix, retried
// on hint collision), and inserts the users row.
func (m *Manager) Register(ctx context.Context, email, password, name string) (*User, error) {
	return m.register(ctx, email, password, name, false)
}

func (m *Manager) register(ctx context.Context, email, password, name string, isDemo bool) (*User, error) {
	email = normalizeEmail(email)
	name = strings.TrimSpace(name)
	if email == "" || password == "" || name == "" {
		return nil, fmt.Errorf("email, password and name are required")
	}

	// Fail fast on a duplicate email before spending a ledger party allocation.
	if _, err := m.GetByEmail(ctx, email); err == nil {
		return nil, ErrEmailTaken
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	party, err := m.allocateParty(ctx, email)
	if err != nil {
		return nil, fmt.Errorf("allocate party: %w", err)
	}

	var u User
	err = m.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, party_id, is_demo)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, email, display_name, party_id, is_demo`,
		email, string(hash), name, party, isDemo,
	).Scan(&u.ID, &u.Email, &u.DisplayName, &u.PartyID, &u.IsDemo)
	if err != nil {
		if isUniqueViolation(err) {
			// Lost a race on email (party_id collision is astronomically unlikely
			// given the random suffix).
			return nil, ErrEmailTaken
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}
	m.cacheLabel(u.PartyID, u.DisplayName)
	return &u, nil
}

// allocateParty derives a partyIdHint from the email local part and allocates a
// party, retrying with a fresh suffix on hint collision (handle-collisions per
// task item 1).
func (m *Manager) allocateParty(ctx context.Context, email string) (string, error) {
	base := slugifyEmailLocal(email)
	var lastErr error
	for attempt := 0; attempt < 5; attempt++ {
		hint := base + "-" + shortSuffix()
		party, err := m.alloc.AllocateParty(ctx, m.appOperatorParty, hint)
		if err != nil {
			// A hint collision (party already exists) surfaces as an API error;
			// a fresh random suffix resolves it. Transient errors also retry.
			lastErr = err
			continue
		}
		return party, nil
	}
	return "", fmt.Errorf("party allocation failed after retries: %w", lastErr)
}

// Authenticate verifies email + password and returns the user. The bcrypt
// comparison is constant-time; unknown-email and wrong-password both yield
// ErrInvalidCredentials.
func (m *Manager) Authenticate(ctx context.Context, email, password string) (*User, error) {
	email = normalizeEmail(email)
	u, hash, err := m.getWithHash(ctx, "email", email)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	return u, nil
}

// DevLogin resolves a seeded demo account by email for POST /api/auth/dev-login.
// Only accounts with is_demo=true are eligible (05 §2). Callers must also gate
// this on the DEV_QUICK_LOGIN flag.
func (m *Manager) DevLogin(ctx context.Context, email string) (*User, error) {
	u, err := m.GetByEmail(ctx, normalizeEmail(email))
	if err != nil {
		return nil, err
	}
	if !u.IsDemo {
		return nil, ErrNotDemo
	}
	return u, nil
}

// GetByID loads a user by primary key (session-cookie resolution path).
func (m *Manager) GetByID(ctx context.Context, id int64) (*User, error) {
	u, _, err := m.getWithHash(ctx, "id", id)
	return u, err
}

// GetByEmail loads a user by email (invite lookup, dedupe, seeding).
func (m *Manager) GetByEmail(ctx context.Context, email string) (*User, error) {
	u, _, err := m.getWithHash(ctx, "email", normalizeEmail(email))
	return u, err
}

// GetByParty loads a user by their Canton party id. Used by the organizer event
// view to render an RSVP row's real name + email (the row shape pinned with the
// web build: {attendeeParty, attendeeName, attendeeEmail, ...}, 05 §2). Returns
// ErrNotFound for a party with no account (e.g. appOperator) so callers fall
// back to the raw party id.
func (m *Manager) GetByParty(ctx context.Context, party string) (*User, error) {
	u, _, err := m.getWithHash(ctx, "party_id", party)
	return u, err
}

// getWithHash reads a single user row (plus password hash) by a whitelisted
// column. `col` is a package-controlled literal, never request input.
func (m *Manager) getWithHash(ctx context.Context, col string, val any) (*User, string, error) {
	var (
		u    User
		hash string
	)
	err := m.pool.QueryRow(ctx, `
		SELECT id, email, password_hash, display_name, party_id, is_demo
		FROM users WHERE `+col+` = $1`, val,
	).Scan(&u.ID, &u.Email, &hash, &u.DisplayName, &u.PartyID, &u.IsDemo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	if err != nil {
		return nil, "", err
	}
	m.cacheLabel(u.PartyID, u.DisplayName)
	return &u, hash, nil
}

// DisplayNameForParty maps a Canton party id back to its owner's display name
// for settlement/organizer views. Best-effort: falls back to the raw party id
// if unknown. Cached because a party's owner never changes.
func (m *Manager) DisplayNameForParty(ctx context.Context, party string) string {
	if party == "" {
		return party
	}
	m.mu.RLock()
	name, ok := m.labelCache[party]
	m.mu.RUnlock()
	if ok {
		return name
	}
	u, _, err := m.getWithHash(ctx, "party_id", party)
	if err != nil {
		return party
	}
	return u.DisplayName
}

func (m *Manager) cacheLabel(party, name string) {
	if party == "" {
		return
	}
	m.mu.Lock()
	m.labelCache[party] = name
	m.mu.Unlock()
}

// demoAccount is one seeded demo user (05 §2 / 08 §2 demo strip).
type demoAccount struct {
	Email string
	Name  string
}

// DemoAccounts is the fixed seeded roster (Organizer + Alice/Bob/Charlie). The
// emails are PINNED to the frontend's hardcoded dev-login strip (08 §2 /
// AuthForms.tsx) — changing them here silently breaks one-click demo login.
var DemoAccounts = []demoAccount{
	{"organizer@showorsow.dev", "Organizer"},
	{"alice@showorsow.dev", "Alice"},
	{"bob@showorsow.dev", "Bob"},
	{"charlie@showorsow.dev", "Charlie"},
}

// demoPassword is the shared password for every seeded demo account (05 §2).
const demoPassword = "demo1234"

// EnsureDemoUsers idempotently creates the demo accounts (SEED_DEMO_USERS). An
// account already present is left untouched; a missing one is registered with
// is_demo=true, allocating its party on first creation.
func (m *Manager) EnsureDemoUsers(ctx context.Context) error {
	for _, d := range DemoAccounts {
		if _, err := m.GetByEmail(ctx, d.Email); err == nil {
			continue // already seeded
		} else if !errors.Is(err, ErrNotFound) {
			return fmt.Errorf("check demo account %s: %w", d.Email, err)
		}
		if _, err := m.register(ctx, d.Email, demoPassword, d.Name, true); err != nil {
			if errors.Is(err, ErrEmailTaken) {
				continue // concurrent seed won the race
			}
			return fmt.Errorf("seed demo account %s: %w", d.Email, err)
		}
	}
	return nil
}

// ---- helpers (unit-tested) ----

// normalizeEmail lowercases + trims so lookups and the UNIQUE(email) constraint
// treat "Alice@X" and "alice@x" as the same account.
func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// slugifyEmailLocal turns the local part of an email into a Canton partyIdHint
// component: lowercase, [a-z0-9] kept, other runs collapsed to a single '-',
// trimmed, capped, with a non-empty fallback. e.g. "Alice.B+tag@x" → "alice-b-tag".
func slugifyEmailLocal(email string) string {
	local := email
	if i := strings.IndexByte(email, '@'); i >= 0 {
		local = email[:i]
	}
	local = strings.ToLower(local)

	var b strings.Builder
	prevDash := false
	for _, r := range local {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			prevDash = false
			continue
		}
		// Any separator (., _, +, -, etc.) collapses to a single dash.
		if !prevDash {
			b.WriteByte('-')
			prevDash = true
		}
	}
	s := strings.Trim(b.String(), "-")
	if s == "" {
		s = "user"
	}
	// Keep the hint short; Canton party hints are bounded and the '::fingerprint'
	// suffix is appended by the participant anyway.
	if len(s) > 32 {
		s = strings.Trim(s[:32], "-")
	}
	return s
}

// shortSuffix returns a 6-hex-char random suffix that disambiguates party hints.
func shortSuffix() string {
	var b [3]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// isUniqueViolation reports whether err is a Postgres unique-constraint failure
// (SQLSTATE 23505). Kept string-based to avoid importing pgconn broadly.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "23505")
}
