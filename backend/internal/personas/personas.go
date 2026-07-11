// Package personas resolves persona names to ledger parties and supplies
// Bearer JWTs for JSON Ledger API v2 calls. It holds all persona JWTs
// server-side — nothing ledger-related ever reaches the browser (05 §1).
package personas

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/showorsow/backend/internal/config"
)

// Manager owns the persona roster and caches refreshed JWTs.
type Manager struct {
	cfg *config.Config
	hc  *http.Client

	mu     sync.Mutex
	tokens map[string]cachedToken // keyed by persona name
}

type cachedToken struct {
	token   string
	expires time.Time
}

// New builds a Manager over the configured personas.
func New(cfg *config.Config, hc *http.Client) *Manager {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Manager{cfg: cfg, hc: hc, tokens: map[string]cachedToken{}}
}

// Party returns the party id for a persona name.
func (m *Manager) Party(name string) (string, bool) {
	p, ok := m.cfg.Personas[strings.ToLower(name)]
	if !ok {
		return "", false
	}
	return p.PartyID, true
}

// Known reports whether a persona name is configured.
func (m *Manager) Known(name string) bool {
	_, ok := m.cfg.Personas[strings.ToLower(name)]
	return ok
}

// Persona returns the full persona record.
func (m *Manager) Persona(name string) (config.Persona, bool) {
	p, ok := m.cfg.Personas[strings.ToLower(name)]
	return p, ok
}

// Names returns the configured persona names.
func (m *Manager) Names() []string {
	out := make([]string, 0, len(m.cfg.Personas))
	for n := range m.cfg.Personas {
		out = append(out, n)
	}
	return out
}

// Token returns a valid Bearer JWT for the persona. On sandbox (no Keycloak,
// no static JWT) it returns an empty string, which callers send as no auth.
func (m *Manager) Token(ctx context.Context, name string) (string, error) {
	name = strings.ToLower(name)
	p, ok := m.cfg.Personas[name]
	if !ok {
		return "", fmt.Errorf("unknown persona %q", name)
	}

	// Static JWT wins (pre-minted / sandbox with fixed token).
	if p.StaticJWT != "" {
		return p.StaticJWT, nil
	}

	// No Keycloak configured → unauthenticated sandbox.
	if m.cfg.Keycloak.Host == "" || p.Username == "" {
		return "", nil
	}

	m.mu.Lock()
	if ct, ok := m.tokens[name]; ok && time.Until(ct.expires) > 30*time.Second {
		tok := ct.token
		m.mu.Unlock()
		return tok, nil
	}
	m.mu.Unlock()

	tok, ttl, err := m.passwordGrant(ctx, p)
	if err != nil {
		return "", err
	}
	m.mu.Lock()
	m.tokens[name] = cachedToken{token: tok, expires: time.Now().Add(ttl)}
	m.mu.Unlock()
	return tok, nil
}

// TokenByParty returns a JWT for the persona owning the given party id.
func (m *Manager) TokenByParty(ctx context.Context, party string) (string, error) {
	p, ok := m.cfg.PersonaByParty(party)
	if !ok {
		return "", fmt.Errorf("no persona for party %q", party)
	}
	return m.Token(ctx, p.Name)
}

type tokenResp struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

// passwordGrant performs the OpenID Connect resource-owner password grant.
// Note the legacy /auth context root appears in some deployments — the caller
// bakes whatever the participant exposes into KEYCLOAK_HOST (03 §4).
func (m *Manager) passwordGrant(ctx context.Context, p config.Persona) (string, time.Duration, error) {
	endpoint := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", m.cfg.Keycloak.Host, m.cfg.Keycloak.Realm)

	form := url.Values{}
	form.Set("grant_type", "password")
	form.Set("client_id", p.ClientID)
	if p.Secret != "" {
		form.Set("client_secret", p.Secret)
	}
	form.Set("username", p.Username)
	form.Set("password", p.Password)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := m.hc.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("keycloak token request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", 0, fmt.Errorf("keycloak token grant status %d", resp.StatusCode)
	}
	var tr tokenResp
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return "", 0, fmt.Errorf("keycloak token decode: %w", err)
	}
	ttl := time.Duration(tr.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return tr.AccessToken, ttl, nil
}
