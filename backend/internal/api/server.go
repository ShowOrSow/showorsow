// Package api holds the HTTP handlers for the 13 REST endpoints (05 §2). It
// owns the stdlib net/http mux, the demo-grade session cookie, and wires the
// ledger/registry/store/personas collaborators plus the settlement runners.
package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/showorsow/backend/internal/config"
	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/personas"
	"github.com/showorsow/backend/internal/registry"
	"github.com/showorsow/backend/internal/settle"
	"github.com/showorsow/backend/internal/store"
)

// Server bundles all dependencies behind the HTTP handlers.
type Server struct {
	cfg      *config.Config
	ledger   *ledger.Client
	personas *personas.Manager
	store    *store.Store
	pkg      ledger.PackageQualifier
	httpc    *http.Client

	runner *settle.Runner

	// registry clients cached per (admin,instrumentId).
	regMu   sync.Mutex
	regByID map[string]*registry.Client

	// token decimals cache (label → decimals) refreshed lazily.
	decMu    sync.Mutex
	decCache map[string]int
}

// New builds a Server and its settlement runner.
func New(cfg *config.Config, lc *ledger.Client, pm *personas.Manager, st *store.Store, pkg ledger.PackageQualifier) *Server {
	s := &Server{
		cfg:      cfg,
		ledger:   lc,
		personas: pm,
		store:    st,
		pkg:      pkg,
		httpc:    &http.Client{Timeout: 30 * time.Second},
		regByID:  map[string]*registry.Client{},
		decCache: map[string]int{},
	}
	s.runner = settle.NewRunner(settle.Deps{
		Cfg:       cfg,
		Ledger:    lc,
		Personas:  pm,
		Store:     st,
		Pkg:       pkg,
		NewIDFunc: newID,
		Registry:  s.registryFor,
		Errorf:    logErrorID,
	})
	return s
}

// Runner exposes the settlement runner (used by main for the watcher Deps).
func (s *Server) SettleDeps() settle.Deps {
	return settle.Deps{
		Cfg:       s.cfg,
		Ledger:    s.ledger,
		Personas:  s.personas,
		Store:     s.store,
		Pkg:       s.pkg,
		NewIDFunc: newID,
		Registry:  s.registryFor,
		Errorf:    logErrorID,
	}
}

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

	// Session
	mux.HandleFunc("POST /api/session", s.handleSessionPost)
	mux.HandleFunc("GET /api/session", s.handleSessionGet)

	// Tokens & balances
	mux.HandleFunc("GET /api/tokens", s.handleTokens)
	mux.HandleFunc("GET /api/balances", s.handleBalances)

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
// ledger/registry failures (05 §2).
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

// requirePersona resolves the active persona and its party, or writes 401.
func (s *Server) requirePersona(w http.ResponseWriter, r *http.Request) (persona, party string, ok bool) {
	persona, ok = s.currentPersona(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "no active session")
		return "", "", false
	}
	party, ok = s.personas.Party(persona)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "unknown persona")
		return "", "", false
	}
	return persona, party, true
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

// withCORS is a permissive CORS wrapper (demo scale; same-origin in prod).
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
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
