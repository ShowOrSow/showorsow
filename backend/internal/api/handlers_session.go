package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/showorsow/backend/internal/settle"
)

// POST /api/session — {persona} → {persona, partyId}. Sets the signed cookie.
func (s *Server) handleSessionPost(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Persona string `json:"persona"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	// Normalize the persona to lowercase before signing: personas.Party and the
	// well-known OrganizerPersona/AppOperatorPersona are lowercase, so a
	// mixed-case "Organizer" must not be stored verbatim or later
	// `persona == cfg.OrganizerPersona` checks silently fail (F11).
	persona := strings.ToLower(req.Persona)
	party, ok := s.personas.Party(persona)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unknown persona")
		return
	}
	s.setSessionCookie(w, persona)
	writeJSON(w, http.StatusOK, map[string]string{"persona": persona, "partyId": party})
}

// GET /api/session — → {persona, partyId, indexerLagMs}. Lag is proxied from the
// indexer healthz (feeds the StaleBadge, 05 §2).
func (s *Server) handleSessionGet(w http.ResponseWriter, r *http.Request) {
	persona, party, ok := s.requirePersona(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"persona":      persona,
		"partyId":      party,
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

// GET /api/balances — [{instrumentId, amount}] for the current persona (live
// Holding interface query, under the persona's own JWT).
func (s *Server) handleBalances(w http.ResponseWriter, r *http.Request) {
	_, party, ok := s.requirePersona(w, r)
	if !ok {
		return
	}
	type bal struct {
		InstrumentID string `json:"instrumentId"`
		Amount       string `json:"amount"`
	}
	out := make([]bal, 0, len(s.cfg.Tokens))
	for _, t := range s.cfg.Tokens {
		sum, err := settle.HoldingSum(ctx(r), s.ledger, party, t.AdminParty, t.InstrumentID)
		if err != nil {
			logErrorID(newErrorID(), "balances-holding", err)
			sum = "0"
		}
		out = append(out, bal{InstrumentID: t.InstrumentID, Amount: sum})
	}
	writeJSON(w, http.StatusOK, out)
}
