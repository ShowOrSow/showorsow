// Package api holds the HTTP handlers for the REST API (05 §2). It owns the
// stdlib net/http mux, the HMAC session cookie carrying the logged-in user id,
// and wires the ledger/registry/store/users collaborators plus the settlement
// runners. Auth is Luma-style real accounts (pivot Jul 11): every user owns a
// Canton party allocated at signup — the persona switcher is gone.
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/showorsow/backend/internal/config"
	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/registry"
	"github.com/showorsow/backend/internal/settle"
	"github.com/showorsow/backend/internal/store"
	"github.com/showorsow/backend/internal/users"
)

// dataStore is the read-model surface the handlers use. *store.Store satisfies
// it; tests inject a fake (organizer-guard table test).
type dataStore interface {
	WriteEventMeta(ctx context.Context, m store.EventMeta) error
	GetEvent(ctx context.Context, eventID string) (*store.EventRow, error)
	ListEventsForUser(ctx context.Context, party string) ([]store.EventRow, error)
	GetRSVP(ctx context.Context, eventID, attendeeParty string) (*store.RSVPRow, error)
	GetRSVPByCid(ctx context.Context, rsvpCid string) (*store.RSVPRow, error)
	GetRSVPByInviteCid(ctx context.Context, inviteCid string) (*store.RSVPRow, error)
	ListRSVPsForEvent(ctx context.Context, eventID string) ([]store.RSVPRow, error)
	GetEventStats(ctx context.Context, eventID string) (*store.EventStats, error)
	GetSettlementPackage(ctx context.Context, eventID string) ([]store.SettlementRow, error)
	GetBalanceDeltas(ctx context.Context, eventID string) ([]store.BalanceDeltaRow, error)
}

// userStore is the account surface the handlers use. *users.Manager satisfies
// it; tests inject a fake.
type userStore interface {
	Register(ctx context.Context, email, password, name string) (*users.User, error)
	Authenticate(ctx context.Context, email, password string) (*users.User, error)
	DevLogin(ctx context.Context, email string) (*users.User, error)
	GetByID(ctx context.Context, id int64) (*users.User, error)
	GetByEmail(ctx context.Context, email string) (*users.User, error)
	GetByParty(ctx context.Context, party string) (*users.User, error)
	DisplayNameForParty(ctx context.Context, party string) string
}

// Server bundles all dependencies behind the HTTP handlers.
type Server struct {
	cfg    *config.Config
	ledger *ledger.Client
	users  userStore
	store  dataStore
	pkg    ledger.PackageQualifier
	httpc  *http.Client

	runner     *settle.Runner
	settleDeps settle.Deps

	// registry clients cached per (admin,instrumentId).
	regMu   sync.Mutex
	regByID map[string]*registry.Client

	// token decimals cache (label → decimals) refreshed lazily.
	decMu    sync.Mutex
	decCache map[string]int
}

// New builds a Server and its settlement runner. st/um are the concrete
// collaborators; they are also handed to the settlement runner (which needs the
// concrete store for balance-snapshot writes) and exposed to handlers behind
// the dataStore/userStore interfaces.
func New(cfg *config.Config, lc *ledger.Client, um *users.Manager, st *store.Store, pkg ledger.PackageQualifier) *Server {
	s := &Server{
		cfg:      cfg,
		ledger:   lc,
		users:    um,
		store:    st,
		pkg:      pkg,
		httpc:    &http.Client{Timeout: 30 * time.Second},
		regByID:  map[string]*registry.Client{},
		decCache: map[string]int{},
	}
	s.settleDeps = settle.Deps{
		Cfg:              cfg,
		Ledger:           lc,
		Store:            st,
		Pkg:              pkg,
		NewIDFunc:        newID,
		Registry:         s.registryFor,
		Errorf:           logErrorID,
		AppOperatorParty: cfg.AppOperatorParty,
		Label:            um.DisplayNameForParty,
	}
	s.runner = settle.NewRunner(s.settleDeps)
	return s
}

// SettleDeps exposes the settlement dependency bundle (used by main for the
// withdrawal watcher).
func (s *Server) SettleDeps() settle.Deps { return s.settleDeps }

// registryFor returns (creating if needed) a registry client for a token,
// resolved by (admin, instrumentId).
func (s *Server) registryFor(admin, instrumentID string) (*registry.Client, error) {
	tok, ok := s.cfg.TokenByAdminInstrument(admin, instrumentID)
	if !ok {
		return nil, fmt.Errorf("no configured token for (%s, %s)", admin, instrumentID)
	}
	key := admin + "|" + instrumentID
	s.regMu.Lock()
	defer s.regMu.Unlock()
	if c, ok := s.regByID[key]; ok {
		return c, nil
	}
	c := registry.New(tok.RegistryBaseURL, s.httpc)
	s.regByID[key] = c
	return c, nil
}

// Routes registers all handlers on a fresh mux and returns it.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	// Auth (Luma-style real accounts, 05 §2).
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("POST /api/auth/dev-login", s.handleDevLogin)
	mux.HandleFunc("GET /api/session", s.handleSessionGet)

	// Unauthenticated config probe — the /login page reads it PRE-session to
	// decide whether to show the demo quick-login strip (05 §2, contract pinned
	// with the web build Jul 11). Must NOT require a session.
	mux.HandleFunc("GET /api/config", s.handleConfig)

	// Tokens & balances
	mux.HandleFunc("GET /api/tokens", s.handleTokens)
	mux.HandleFunc("GET /api/balances", s.handleBalances)

	// Faucet (in-app test tokens, 05 §6c) — gated by DEV_FAUCET.
	mux.HandleFunc("POST /api/faucet", s.handleFaucet)

	// Events
	mux.HandleFunc("POST /api/events", s.handleCreateEvent)
	mux.HandleFunc("GET /api/events", s.handleListEvents)
	mux.HandleFunc("GET /api/events/{eventId}", s.handleGetEvent)
	mux.HandleFunc("POST /api/events/{eventId}/invites", s.handleInvite)
	mux.HandleFunc("POST /api/events/{eventId}/checkin", s.handleCheckin)
	mux.HandleFunc("POST /api/events/{eventId}/close", s.handleClose)
	mux.HandleFunc("GET /api/events/{eventId}/settlement", s.handleSettlement)

	// Invites & RSVPs
	mux.HandleFunc("POST /api/invites/{inviteCid}/accept", s.handleAccept)
	mux.HandleFunc("POST /api/invites/{inviteCid}/decline", s.handleDecline)
	mux.HandleFunc("POST /api/rsvps/{rsvpCid}/stake", s.handleStake)
	mux.HandleFunc("POST /api/rsvps/{rsvpCid}/cancel", s.handleCancel)

	return withCORS(mux)
}

// ---- shared response helpers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// errBody is the standard error envelope. stage/errorId are populated for
// ledger/registry failures (05 §2); stage:'auth' marks an unauthenticated call.
type errBody struct {
	Error   string `json:"error"`
	Stage   string `json:"stage,omitempty"`
	Detail  string `json:"detail,omitempty"`
	ErrorID string `json:"errorId,omitempty"`
	RSVPCid string `json:"rsvpCid,omitempty"`
}

// writeErr502 writes the 502 {stage, detail, errorId} contract. rsvpCid is
// included when set (stake flow, 05 §3).
func writeErr502(w http.ResponseWriter, stage, rsvpCid string, err error) {
	id := newErrorID()
	logErrorID(id, stage, err)
	writeJSON(w, http.StatusBadGateway, errBody{
		Error:   "upstream failure",
		Stage:   stage,
		Detail:  err.Error(),
		ErrorID: id,
		RSVPCid: rsvpCid,
	})
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errBody{Error: msg})
}

// writeAuthErr writes the uniform 401 {stage:'auth'} for unauthenticated API
// calls (05 §2 — the frontend redirects to /login on this).
func writeAuthErr(w http.ResponseWriter) {
	writeJSON(w, http.StatusUnauthorized, errBody{Error: "unauthenticated", Stage: "auth"})
}

// requireUser resolves the logged-in user from the session cookie, or writes a
// uniform 401 {stage:'auth'}.
func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (*users.User, bool) {
	uid, ok := s.currentUserID(r)
	if !ok {
		writeAuthErr(w)
		return nil, false
	}
	u, err := s.users.GetByID(ctx(r), uid)
	if err != nil {
		// Stale/tampered cookie or deleted account → treat as unauthenticated.
		writeAuthErr(w)
		return nil, false
	}
	return u, true
}

// requireOrganizer resolves the session user AND the event, enforcing that the
// user is the event's organizer (session party == events.organizer_party).
// Organizer-only actions — invites, checkin, close — call this; a non-organizer
// gets 403 (05 §2 / task item 3). Returns before any ledger write on failure.
func (s *Server) requireOrganizer(w http.ResponseWriter, r *http.Request, eventID string) (*users.User, *store.EventRow, bool) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return nil, nil, false
	}
	ev, err := s.store.GetEvent(ctx(r), eventID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "event not found")
		return nil, nil, false
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return nil, nil, false
	}
	if u.PartyID != ev.OrganizerParty {
		writeErr(w, http.StatusForbidden, "only the organizer may perform this action")
		return nil, nil, false
	}
	return u, ev, true
}

// labelForParty maps a party id to its owner's display name for UI responses.
func (s *Server) labelForParty(ctx context.Context, party string) string {
	return s.users.DisplayNameForParty(ctx, party)
}

func decodeBody(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(v)
}

// newID returns a short unique id for command ids.
func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// newErrorID returns a Grafana-searchable error id.
func newErrorID() string {
	return "sos-" + newID()
}

// logErrorID logs a structured, searchable error (05 §2 — errorId in Grafana).
func logErrorID(errorID, stage string, err error) {
	log.Printf("errorId=%s stage=%s err=%v", errorID, stage, err)
}

// withCORS allows credentialed requests from the configured web origin only
// (WEB_ORIGIN env, default the local dev server) — reflect-any-origin with
// credentials is a session-theft pattern the review gate flagged.
func withCORS(next http.Handler) http.Handler {
	allowed := os.Getenv("WEB_ORIGIN")
	if allowed == "" {
		allowed = "http://localhost:3000"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ctx returns the request context (indirection point for future deadlines).
func ctx(r *http.Request) context.Context { return r.Context() }
