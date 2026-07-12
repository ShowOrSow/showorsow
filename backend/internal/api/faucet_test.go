package api

import (
	"encoding/json"
	"testing"

	"github.com/showorsow/backend/internal/config"
	"github.com/showorsow/backend/internal/registry"
)

// TestPlanFaucet covers the POST /api/faucet mode selection (05 §6c): a mintable
// token mints on-ledger; a registry token redirects to its faucetUrl, falling
// back to the supplied default when none is configured.
func TestPlanFaucet(t *testing.T) {
	const def = "https://faucet.example/"
	tests := []struct {
		name     string
		tok      config.TokenConfig
		wantMint bool
		wantURL  string
	}{
		{
			name:     "mintable demo token → mint mode",
			tok:      config.TokenConfig{Label: "SHOW", Mintable: true, IssuerParty: "issuer::1"},
			wantMint: true,
			wantURL:  "", // no external URL in mint mode
		},
		{
			name:     "registry token with faucetUrl → external mode uses it",
			tok:      config.TokenConfig{Label: "cBTC", FaucetURL: "https://bitsafe.example/cbtc"},
			wantMint: false,
			wantURL:  "https://bitsafe.example/cbtc",
		},
		{
			name:     "registry token without faucetUrl → external mode falls back",
			tok:      config.TokenConfig{Label: "cETH"},
			wantMint: false,
			wantURL:  def,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := planFaucet(tc.tok, def)
			if got.Mint != tc.wantMint {
				t.Fatalf("planFaucet Mint = %v, want %v", got.Mint, tc.wantMint)
			}
			if got.URL != tc.wantURL {
				t.Fatalf("planFaucet URL = %q, want %q", got.URL, tc.wantURL)
			}
		})
	}
}

// TestFaucetIssuerResolution covers the issuer fallback chain (per-token
// issuerParty → global FaucetIssuerParty → instrument admin, 05 §6c).
func TestFaucetIssuerResolution(t *testing.T) {
	tests := []struct {
		name        string
		tokenIssuer string
		globalParty string
		admin       string
		want        string
	}{
		{"per-token wins", "issuer::1", "global::2", "admin::3", "issuer::1"},
		{"global fallback", "", "global::2", "admin::3", "global::2"},
		{"admin last resort", "", "", "admin::3", "admin::3"},
		{"none configured", "", "", "", ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := firstNonEmpty(tc.tokenIssuer, tc.globalParty, tc.admin)
			if got != tc.want {
				t.Fatalf("issuer = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestDemoModeExtraArgsShape pins the demo-token ExtraArgs value passed by the
// stake flow + settlement in demo mode (05 §6c / 04 §1.7): a ChoiceContext
// record (never null) with empty context + meta values, and NO disclosed
// contracts. A regression here (e.g. a null context) fails the Daml JSON decode
// of the allocation choices (F9).
func TestDemoModeExtraArgsShape(t *testing.T) {
	cc := registry.DemoChoiceContext()
	if len(cc.DisclosedContracts) != 0 {
		t.Fatalf("demo ChoiceContext must carry no disclosed contracts, got %d", len(cc.DisclosedContracts))
	}

	var got map[string]any
	if err := json.Unmarshal(cc.ExtraArgs, &got); err != nil {
		t.Fatalf("ExtraArgs is not valid JSON: %v", err)
	}
	// Shape: {"context":{"values":{}},"meta":{"values":{}}}.
	ctxRec, ok := got["context"].(map[string]any)
	if !ok {
		t.Fatalf("ExtraArgs.context missing or not a record: %#v", got["context"])
	}
	if vals, ok := ctxRec["values"].(map[string]any); !ok || len(vals) != 0 {
		t.Fatalf("ExtraArgs.context.values must be an empty record, got %#v", ctxRec["values"])
	}
	metaRec, ok := got["meta"].(map[string]any)
	if !ok {
		t.Fatalf("ExtraArgs.meta missing or not a record: %#v", got["meta"])
	}
	if vals, ok := metaRec["values"].(map[string]any); !ok || len(vals) != 0 {
		t.Fatalf("ExtraArgs.meta.values must be an empty record, got %#v", metaRec["values"])
	}

	// EmptyExtraArgs and DemoChoiceContext must agree.
	if string(registry.EmptyExtraArgs()) != string(cc.ExtraArgs) {
		t.Fatalf("EmptyExtraArgs and DemoChoiceContext.ExtraArgs diverged")
	}
}
