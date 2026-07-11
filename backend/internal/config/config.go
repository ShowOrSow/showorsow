// Package config loads backend configuration from the process environment,
// hydrated from a .env file at startup (see 05-backend.md §1).
package config

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// TokenConfig is one configured instrument. Per 03-tech-stack.md §6 the
// (adminParty, instrumentId) pair is treated as opaque config; decimals are
// NEVER baked in here — they are read live from the registry metadata endpoint.
type TokenConfig struct {
	Label           string `json:"label"`
	AdminParty      string `json:"adminParty"`
	InstrumentID    string `json:"instrumentId"`
	RegistryBaseURL string `json:"registryBaseUrl"`
}

// KeycloakConfig holds the OpenID password-grant parameters used on
// LocalNet/DevNet. On the unauthenticated sandbox this is empty and JWT
// refresh is skipped entirely.
type KeycloakConfig struct {
	Host  string // e.g. https://keycloak.example/ (may include legacy /auth context root)
	Realm string
}

// Persona binds a persona name to its ledger party plus the credentials the
// personas module needs to obtain a Bearer JWT.
type Persona struct {
	Name string
	// PartyID is the fully-qualified Canton party id.
	PartyID string
	// StaticJWT, if set, is used verbatim (sandbox / pre-minted token).
	StaticJWT string
	// Keycloak password-grant credentials (LocalNet/DevNet). ClientID/Secret
	// may be shared; Username/Password identify the party's user.
	ClientID string
	Secret   string
	Username string
	Password string
}

// Config is the fully-parsed backend configuration.
type Config struct {
	ListenAddr       string
	LedgerJSONAPIURL string
	IndexerHealthURL string // for GET /api/session indexerLagMs proxy
	NeonDatabaseURL  string
	SettleBuffer     time.Duration
	Tokens           []TokenConfig
	Personas         map[string]Persona // keyed by persona name
	Keycloak         KeycloakConfig
	SessionSecret    []byte // HMAC key for the signed session cookie
	// SequentialSettle selects the R6 fallback: CloseEvent once per RSVP with a
	// single-item settleItems list instead of one atomic exercise.
	SequentialSettle bool

	// AppOperator / Organizer well-known persona names used by the runners.
	AppOperatorPersona string
	OrganizerPersona   string
}

// personaNames is the fixed demo roster. PARTY_<UPPER(name)> + persona JWT/
// Keycloak vars are read for each.
var personaNames = []string{"organizer", "appoperator", "attendee1", "attendee2", "attendee3"}

// Load reads .env (if present) into the environment, then parses Config.
func Load(envPath string) (*Config, error) {
	if err := loadDotEnv(envPath); err != nil {
		return nil, err
	}

	c := &Config{
		ListenAddr:         getenvDefault("LISTEN_ADDR", ":8080"),
		LedgerJSONAPIURL:   strings.TrimRight(os.Getenv("LEDGER_JSON_API_URL"), "/"),
		IndexerHealthURL:   strings.TrimRight(getenvDefault("INDEXER_HEALTH_URL", ""), "/"),
		NeonDatabaseURL:    os.Getenv("NEON_DATABASE_URL"),
		Personas:           map[string]Persona{},
		AppOperatorPersona: getenvDefault("APP_OPERATOR_PERSONA", "appoperator"),
		OrganizerPersona:   getenvDefault("ORGANIZER_PERSONA", "organizer"),
		SequentialSettle:   parseBool(os.Getenv("SETTLE_SEQUENTIAL_FALLBACK")),
	}

	// SETTLE_BUFFER default 24h.
	buf := getenvDefault("SETTLE_BUFFER", "24h")
	d, err := time.ParseDuration(buf)
	if err != nil {
		return nil, fmt.Errorf("SETTLE_BUFFER: %w", err)
	}
	c.SettleBuffer = d

	// TOKENS JSON array.
	if raw := os.Getenv("TOKENS"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &c.Tokens); err != nil {
			return nil, fmt.Errorf("TOKENS: %w", err)
		}
	}

	c.Keycloak = KeycloakConfig{
		Host:  strings.TrimRight(os.Getenv("KEYCLOAK_HOST"), "/"),
		Realm: os.Getenv("KEYCLOAK_REALM"),
	}

	// Session secret (HMAC). Falls back to a dev constant with a warning-worthy
	// default; the demo-grade auth is deliberate & documented (05 §2).
	sec := getenvDefault("SESSION_SECRET", "showorsow-dev-session-secret-change-me")
	c.SessionSecret = []byte(sec)

	// Personas.
	for _, name := range personaNames {
		up := strings.ToUpper(name)
		party := os.Getenv("PARTY_" + up)
		if party == "" {
			// Skip personas without a configured party — allows partial config
			// during local bring-up. Handlers validate presence at request time.
			continue
		}
		p := Persona{
			Name:      name,
			PartyID:   party,
			StaticJWT: os.Getenv("JWT_" + up),
			ClientID:  getenvDefault("KEYCLOAK_CLIENT_ID_"+up, os.Getenv("KEYCLOAK_CLIENT_ID")),
			Secret:    getenvDefault("KEYCLOAK_CLIENT_SECRET_"+up, os.Getenv("KEYCLOAK_CLIENT_SECRET")),
			Username:  getenvDefault("KEYCLOAK_USERNAME_"+up, ""),
			Password:  getenvDefault("KEYCLOAK_PASSWORD_"+up, ""),
		}
		c.Personas[name] = p
	}

	return c, nil
}

// PersonaByParty returns the persona owning a given party id, if configured.
func (c *Config) PersonaByParty(party string) (Persona, bool) {
	for _, p := range c.Personas {
		if p.PartyID == party {
			return p, true
		}
	}
	return Persona{}, false
}

// TokenByLabel resolves a configured token by its label.
func (c *Config) TokenByLabel(label string) (TokenConfig, bool) {
	for _, t := range c.Tokens {
		if t.Label == label {
			return t, true
		}
	}
	return TokenConfig{}, false
}

// TokenByAdminInstrument resolves a token by (admin, instrumentId).
func (c *Config) TokenByAdminInstrument(admin, instrumentID string) (TokenConfig, bool) {
	for _, t := range c.Tokens {
		if t.AdminParty == admin && t.InstrumentID == instrumentID {
			return t, true
		}
	}
	return TokenConfig{}, false
}

func getenvDefault(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func parseBool(s string) bool {
	b, _ := strconv.ParseBool(strings.TrimSpace(s))
	return b
}

// loadDotEnv parses a minimal KEY=VALUE .env file and sets any keys not already
// present in the environment. Missing file is not an error (env may be set
// externally). Supports quoted values and #-comments.
func loadDotEnv(path string) error {
	if path == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimPrefix(line, "export ")
		}
		eq := strings.IndexByte(line, '=')
		if eq < 0 {
			continue
		}
		key := strings.TrimSpace(line[:eq])
		val := strings.TrimSpace(line[eq+1:])
		val = unquote(val)
		if _, present := os.LookupEnv(key); !present {
			os.Setenv(key, val)
		}
	}
	return sc.Err()
}

func unquote(s string) string {
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			return s[1 : len(s)-1]
		}
	}
	// Strip trailing inline comment for unquoted values.
	if i := strings.Index(s, " #"); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return s
}
