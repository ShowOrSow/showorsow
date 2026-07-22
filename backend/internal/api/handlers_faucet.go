package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/showorsow/backend/internal/config"
	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/settle"
)

// bitSafeFaucetURL is the default external faucet the UI opens for a registry
// token (cBTC / cETH) that carries no per-token faucetUrl (05 §6c).
// Self-serve cBTC DevNet faucet. (The older faucet.bitsafe.dev host no longer
// resolves — verified 2026-07-23 — so a token configured without an explicit
// faucetUrl used to send the user to a dead domain.)
const bitSafeFaucetURL = "https://cbtc-faucet.bitsafe.finance/"

// faucetResp is the POST /api/faucet response. Exactly one of the two shapes is
// populated: the mint result {credited, newBalance} for a mintable demo token,
// or the external-faucet redirect {external, url, party} for a registry token.
type faucetResp struct {
	// mintable demo-token mode
	Credited   string `json:"credited,omitempty"`
	NewBalance string `json:"newBalance,omitempty"`
	// registry-token mode
	External bool   `json:"external,omitempty"`
	URL      string `json:"url,omitempty"`
	Party    string `json:"party,omitempty"`
}

// POST /api/faucet — {tokenLabel, amount?} → {credited, newBalance} (mintable
// demo token) | {external, url, party} (registry token). Gated by DEV_FAUCET
// (05 §6c). Requires a session (mints/returns for the caller's own party).
func (s *Server) handleFaucet(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.DevFaucet {
		writeErr(w, http.StatusForbidden, "faucet is disabled")
		return
	}
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}

	var req struct {
		TokenLabel string `json:"tokenLabel"`
		// NOTE: no client-supplied amount. A faucet dispenses a fixed,
		// server-configured amount (FAUCET_AMOUNT) — trusting a client amount
		// would let any session mint arbitrarily (even though DEV_FAUCET-gated).
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.TokenLabel == "" {
		writeErr(w, http.StatusBadRequest, "tokenLabel is required")
		return
	}
	tok, found := s.cfg.TokenByLabel(req.TokenLabel)
	if !found {
		writeErr(w, http.StatusNotFound, "unknown token")
		return
	}

	// Mode selection is by token config (05 §6c): a mintable token is the SHOW
	// demo token (minted directly on-ledger); anything else is registry-backed
	// and the UI is redirected to the external faucet.
	plan := planFaucet(tok, bitSafeFaucetURL)
	if plan.Mint {
		s.faucetMint(w, r, u.PartyID, tok)
		return
	}
	writeJSON(w, http.StatusOK, faucetResp{External: true, URL: plan.URL, Party: u.PartyID})
}

// faucetPlan is the decided faucet action for a token (mode selection, 05 §6c).
// Mint=true → exercise DemoIssuer.Mint; otherwise redirect the UI to URL.
type faucetPlan struct {
	Mint bool
	URL  string // external redirect URL when Mint is false
}

// planFaucet decides the faucet mode from token config: a mintable token mints
// on-ledger; anything else redirects to its faucetUrl (falling back to
// defaultURL). Pure and unit-tested.
func planFaucet(tok config.TokenConfig, defaultURL string) faucetPlan {
	if tok.Mintable {
		return faucetPlan{Mint: true}
	}
	url := tok.FaucetURL
	if url == "" {
		url = defaultURL
	}
	return faucetPlan{Mint: false, URL: url}
}

// faucetMint mints the demo token to the caller's party by exercising
// DemoIssuer.Mint as the issuer, then returns the refreshed balance (05 §6c).
func (s *Server) faucetMint(w http.ResponseWriter, r *http.Request, recipientParty string, tok config.TokenConfig) {
	// Fixed server-configured dispense amount — never client-controlled.
	amount := s.cfg.FaucetAmount
	if amount == "" {
		amount = "1.0"
	}

	// Issuer resolution: per-token issuerParty first, then the global
	// FAUCET_ISSUER_PARTY, then the instrument admin (instrumentId.admin = issuer
	// for the SHOW token, 04 §1.7).
	issuer := firstNonEmpty(tok.IssuerParty, s.cfg.FaucetIssuerParty, tok.AdminParty)
	if issuer == "" {
		writeErr502(w, "faucet-mint", "", errors.New("no faucet issuer party configured"))
		return
	}

	issuerCid, issuerTemplate, err := s.demoIssuerContract(ctx(r), issuer)
	if err != nil {
		writeErr502(w, "faucet-mint", "", err)
		return
	}

	mintArg, _ := json.Marshal(map[string]any{"recipient": recipientParty, "amount": amount})
	_, err = s.ledger.SubmitAndWait(ctx(r), issuer, "faucet-mint-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     issuerTemplate,
			ContractID:     issuerCid,
			Choice:         "Mint",
			ChoiceArgument: mintArg,
		}}}, nil)
	if err != nil {
		writeErr502(w, "faucet-mint", "", err)
		return
	}

	// Refreshed balance for the recipient (the DemoHolding lands directly — no
	// accept step, 05 §6c). instrumentId.admin = issuer for SHOW; use the token's
	// configured admin/instrument to sum.
	newBal, err := settle.HoldingSum(ctx(r), s.ledger, recipientParty, tok.AdminParty, tok.InstrumentID)
	if err != nil {
		logErrorID(newErrorID(), "faucet-balance", err)
		newBal = ""
	}
	writeJSON(w, http.StatusOK, faucetResp{Credited: amount, NewBalance: newBal})
}

// demoIssuerContract finds the DemoIssuer contract id (and its full templateId)
// visible to the issuer party. The DemoIssuer is matched by ENTITY name only —
// the demo-token package/module id is not known to the backend (it ships in its
// own DAR, 05 §6c). The exercise reuses the DISCOVERED templateId so no package
// id needs to be configured.
func (s *Server) demoIssuerContract(ctx context.Context, issuer string) (cid, templateID string, err error) {
	acs, err := s.ledger.ActiveContracts(ctx, issuer, []ledger.CumulativeFilter{{
		WildcardFilter: &ledger.WildcardFilter{IncludeCreatedEventBlob: false},
	}})
	if err != nil {
		return "", "", err
	}
	for _, ac := range acs {
		if ledger.MatchesEntity(ac.CreatedEvent.TemplateID, ledger.EntityDemoIssuer) {
			return ac.CreatedEvent.ContractID, ac.CreatedEvent.TemplateID, nil
		}
	}
	return "", "", errors.New("no DemoIssuer contract visible (is the demo-token DAR deployed and the issuer party correct?)")
}

// firstNonEmpty returns the first non-empty string argument.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}
