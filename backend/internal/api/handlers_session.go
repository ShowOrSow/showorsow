package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/showorsow/backend/internal/settle"
	"github.com/showorsow/backend/internal/users"
)

// userView is the public user shape returned by auth + session endpoints
// (08 §1: AccountMenu shows name, email, truncated party id).
type userView struct {
	Email   string `json:"email"`
	Name    string `json:"name"`
	PartyID string `json:"partyId"`
}

func toUserView(u *users.User) userView {
	return userView{Email: u.Email, Name: u.DisplayName, PartyID: u.PartyID}
}

// POST /api/auth/register — {email, password, name} → session cookie + {user}.
// Allocates the user's Canton party and inserts the users row (05 §2).
func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Name     string `json:"name"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	u, err := s.users.Register(ctx(r), req.Email, req.Password, req.Name)
	if errors.Is(err, users.ErrEmailTaken) {
		writeJSON(w, http.StatusConflict, errBody{Error: "email already registered", Stage: "user"})
		return
	}
	if err != nil {
		// Party allocation / DB failure. Party allocation is a ledger op, so
		// surface it as a 502 with a searchable errorId.
		writeErr502(w, "register", "", err)
		return
	}
	s.setSessionCookie(w, u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserView(u)})
}

// POST /api/auth/login — {email, password} → session cookie + {user}.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	u, err := s.users.Authenticate(ctx(r), req.Email, req.Password)
	if errors.Is(err, users.ErrInvalidCredentials) {
		writeJSON(w, http.StatusUnauthorized, errBody{Error: "invalid email or password", Stage: "auth"})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.setSessionCookie(w, u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserView(u)})
}

// POST /api/auth/logout — clears the session cookie → 204.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	s.clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/auth/dev-login — {email} → session cookie + {user}. Seeded demo
// accounts ONLY, and only when DEV_QUICK_LOGIN=true (demo-speed login, off in
// anything shared, 05 §2).
func (s *Server) handleDevLogin(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DevQuickLogin {
		writeErr(w, http.StatusForbidden, "dev quick-login is disabled")
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	u, err := s.users.DevLogin(ctx(r), req.Email)
	if errors.Is(err, users.ErrNotFound) || errors.Is(err, users.ErrNotDemo) {
		writeJSON(w, http.StatusUnauthorized, errBody{Error: "not a demo account", Stage: "auth"})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	s.setSessionCookie(w, u.ID)
	writeJSON(w, http.StatusOK, map[string]any{"user": toUserView(u)})
}

// GET /api/session — → {user:{email, name, partyId}, indexerLagMs}. Lag feeds
// the StaleBadge (05 §2). Unauthenticated → uniform 401 {stage:'auth'}.
func (s *Server) handleSessionGet(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":         toUserView(u),
		"indexerLagMs": s.indexerLagMs(r),
	})
}

// indexerLagMs proxies GET {INDEXER_HEALTH_URL}/healthz → lagMs. On any failure
// returns -1 (StaleBadge treats negative as "unknown / indexer down").
func (s *Server) indexerLagMs(r *http.Request) int64 {
	if s.cfg.IndexerHealthURL == "" {
		return -1
	}
	req, err := http.NewRequestWithContext(ctx(r), http.MethodGet, s.cfg.IndexerHealthURL+"/healthz", nil)
	if err != nil {
		return -1
	}
	resp, err := s.httpc.Do(req)
	if err != nil {
		return -1
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return -1
	}
	body, _ := io.ReadAll(resp.Body)
	var hz struct {
		LastOffset string `json:"lastOffset"`
		LagMs      int64  `json:"lagMs"`
	}
	if err := json.Unmarshal(body, &hz); err != nil {
		return -1
	}
	return hz.LagMs
}

// GET /api/config — unauthenticated probe → {devQuickLogin, devFaucet}. The
// /login page reads this pre-session (GET /api/session 401s before login, so
// the flags can't ride on it) to show/hide the demo quick-login strip and the
// in-app faucet affordance (05 §2 / §6c). No session required by design.
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"devQuickLogin": s.cfg.DevQuickLogin,
		"devFaucet":     s.cfg.DevFaucet,
	})
}

// GET /api/tokens — configured tokens + live decimals from registry metadata.
func (s *Server) handleTokens(w http.ResponseWriter, r *http.Request) {
	type tokenOut struct {
		Label        string `json:"label"`
		AdminParty   string `json:"adminParty"`
		InstrumentID string `json:"instrumentId"`
		Decimals     int    `json:"decimals"`
	}
	out := make([]tokenOut, 0, len(s.cfg.Tokens))
	for _, t := range s.cfg.Tokens {
		dec := s.decimalsForToken(r, t.Label, t.AdminParty, t.InstrumentID)
		out = append(out, tokenOut{
			Label:        t.Label,
			AdminParty:   t.AdminParty,
			InstrumentID: t.InstrumentID,
			Decimals:     dec,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

// decimalsForToken reads decimals live from the registry (cached). Returns -1 on
// failure so the UI can flag a metadata problem rather than silently using 0.
func (s *Server) decimalsForToken(r *http.Request, label, admin, instrumentID string) int {
	s.decMu.Lock()
	if d, ok := s.decCache[label]; ok {
		s.decMu.Unlock()
		return d
	}
	s.decMu.Unlock()

	rc, err := s.registryFor(admin, instrumentID)
	if err != nil {
		return -1
	}
	d, err := rc.Decimals(ctx(r), instrumentID)
	if err != nil {
		logErrorID(newErrorID(), "registry-metadata", err)
		return -1
	}
	s.decMu.Lock()
	s.decCache[label] = d
	s.decMu.Unlock()
	return d
}

// GET /api/balances — [{instrumentId, amount}] for the logged-in user (live
// Holding interface query as the user's own party).
func (s *Server) handleBalances(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	type bal struct {
		InstrumentID string `json:"instrumentId"`
		Amount       string `json:"amount"`
	}
	out := make([]bal, 0, len(s.cfg.Tokens))
	for _, t := range s.cfg.Tokens {
		sum, err := settle.HoldingSum(ctx(r), s.ledger, u.PartyID, t.AdminParty, t.InstrumentID)
		if err != nil {
			logErrorID(newErrorID(), "balances-holding", err)
			sum = "0"
		}
		out = append(out, bal{InstrumentID: t.InstrumentID, Amount: sum})
	}
	writeJSON(w, http.StatusOK, out)
}
