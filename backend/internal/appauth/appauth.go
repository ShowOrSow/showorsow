// Package appauth supplies the ledger Bearer JWT for the app's own party
// (appOperator). Under the Luma-style real-accounts model (pivot Jul 11) it
// replaces the persona JWT roster: the backend holds a token ONLY for
// appOperator. Registered users act on the ledger under their own party, but
// minting per-user DevNet JWTs is a documented MVP limitation (05 §2) — every
// user party resolves to the empty token (no Authorization header), which is
// correct on the unauthenticated sandbox / LocalNet.
package appauth

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

// TokenSource implements ledger.TokenSource. It caches the appOperator JWT and
// refreshes it via the Keycloak password grant when configured.
type TokenSource struct {
	cfg *config.Config
	hc  *http.Client

	mu     sync.Mutex
	cached cachedToken
}

type cachedToken struct {
	token   string
	expires time.Time
}

// New builds a TokenSource over the appOperator credentials in cfg.
func New(cfg *config.Config, hc *http.Client) *TokenSource {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &TokenSource{cfg: cfg, hc: hc}
}

// TokenByParty returns a Bearer JWT for the acting party. Only the appOperator
// party carries a token; every other party (registered users) resolves to "",
// meaning the ledger client sends no Authorization header. On the sandbox that
// is the intended unauthenticated mode; on DevNet, per-user JWTs are a
// documented limitation (05 §2).
func (t *TokenSource) TokenByParty(ctx context.Context, party string) (string, error) {
	if party == "" || t.cfg.AppOperatorParty == "" || party != t.cfg.AppOperatorParty {
		return "", nil
	}

	auth := t.cfg.AppOperator
	// Static JWT wins (pre-minted / sandbox with a fixed token).
	if auth.StaticJWT != "" {
		return auth.StaticJWT, nil
	}
	// No Keycloak configured → unauthenticated sandbox.
	if t.cfg.Keycloak.Host == "" || auth.Username == "" {
		return "", nil
	}

	t.mu.Lock()
	if time.Until(t.cached.expires) > 30*time.Second {
		tok := t.cached.token
		t.mu.Unlock()
		return tok, nil
	}
	t.mu.Unlock()

	tok, ttl, err := t.passwordGrant(ctx, auth)
	if err != nil {
		return "", err
	}
	t.mu.Lock()
	t.cached = cachedToken{token: tok, expires: time.Now().Add(ttl)}
	t.mu.Unlock()
	return tok, nil
}

type tokenResp struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
}

// passwordGrant performs the OpenID Connect resource-owner password grant for
// appOperator. KEYCLOAK_HOST may include the legacy /auth context root — the
// caller bakes whatever the participant exposes into it (03 §4).
func (t *TokenSource) passwordGrant(ctx context.Context, auth config.AppOperatorAuth) (string, time.Duration, error) {
	endpoint := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", t.cfg.Keycloak.Host, t.cfg.Keycloak.Realm)

	form := url.Values{}
	form.Set("grant_type", "password")
	form.Set("client_id", auth.ClientID)
	if auth.Secret != "" {
		form.Set("client_secret", auth.Secret)
	}
	form.Set("username", auth.Username)
	form.Set("password", auth.Password)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := t.hc.Do(req)
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
