// Package ledger is a plain net/http client for JSON Ledger API v2. It is the
// only path by which the backend writes to the ledger (05 §1). No go-daml.
package ledger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// TokenSource yields a Bearer JWT for a party. Empty string = no auth
// (unauthenticated sandbox).
type TokenSource interface {
	TokenByParty(ctx context.Context, party string) (string, error)
}

// Client talks to a single JSON Ledger API v2 base URL.
type Client struct {
	baseURL string
	hc      *http.Client
	tokens  TokenSource
	userID  string
	// synchronizerID is optional; when set it is attached to submissions.
	synchronizerID string
}

// New constructs a ledger Client.
func New(baseURL string, tokens TokenSource, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 60 * time.Second}
	}
	return &Client{
		baseURL: strings.TrimRight(baseURL, "/"),
		hc:      hc,
		tokens:  tokens,
	}
}

// WithSynchronizer sets the synchronizer id attached to submissions.
func (c *Client) WithSynchronizer(id string) *Client { c.synchronizerID = id; return c }

// APIError is a non-2xx response from the ledger API.
type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("ledger api status %d: %s", e.StatusCode, truncate(e.Body, 512))
}

// SubmitAndWait submits create/exercise commands acting as `party`, waits for
// the transaction, and returns its flattened events. `disclosed` carries
// registry blobs where the acting party is not a stakeholder.
func (c *Client) SubmitAndWait(ctx context.Context, party, commandID string, cmds []Command, disclosed []DisclosedContract) (*SubmitAndWaitResponse, error) {
	// Canton 3.4: the command batch is NESTED under "commands", with a sibling
	// "transactionFormat" that selects the returned events. We request a wildcard
	// filter (all created events + blobs) plus interface views for the standard
	// token interfaces, so runners can extract recreated contract ids by template
	// AND created Allocation/TransferInstruction cids by interface view (F3/F5).
	req := SubmitAndWaitForTransactionRequest{
		Commands: JsCommands{
			Commands:           cmds,
			CommandID:          commandID,
			ActAs:              []string{party},
			UserID:             c.userID,
			DisclosedContracts: disclosed,
			SynchronizerID:     c.synchronizerID,
		},
		TransactionFormat: TransactionFormat{
			TransactionShape: "TRANSACTION_SHAPE_LEDGER_EFFECTS",
			EventFormat: EventFormat{
				Verbose:        true,
				FiltersByParty: map[string]Filters{party: {Cumulative: submissionFilters()}},
			},
		},
	}
	var out SubmitAndWaitResponse
	if err := c.do(ctx, party, http.MethodPost, "/v2/commands/submit-and-wait-for-transaction", req, &out); err != nil {
		return nil, err
	}
	// Normalise: some deployments nest events under transaction, others flat.
	if len(out.Transaction.Events) == 0 && len(out.TransactionTree) > 0 {
		_ = json.Unmarshal(out.TransactionTree, &out.Transaction)
	}
	return &out, nil
}

// submissionFilters is the transactionFormat cumulative filter for the acting
// party: a wildcard (every created contract, with blob) plus interface views for
// the standard token interfaces so created Allocation / TransferInstruction /
// Holding contracts carry an interfaceView in the result (F5).
func submissionFilters() []CumulativeFilter {
	return []CumulativeFilter{
		{WildcardFilter: &WildcardFilter{IncludeCreatedEventBlob: true}},
		{InterfaceFilter: &InterfaceFilter{InterfaceID: AllocationInterfaceID, IncludeInterfaceView: true}},
		{InterfaceFilter: &InterfaceFilter{InterfaceID: TransferInstructionInterfaceID, IncludeInterfaceView: true}},
		{InterfaceFilter: &InterfaceFilter{InterfaceID: HoldingInterfaceID, IncludeInterfaceView: true}},
	}
}

// ActiveContracts queries POST /v2/state/active-contracts for a party.
// JSON API v2 cannot filter server-side beyond template/interface identity —
// owner/instrument filtering is done client-side by callers (03 §1).
func (c *Client) ActiveContracts(ctx context.Context, party string, filters []CumulativeFilter) ([]ActiveContract, error) {
	// activeAtOffset is required (Canton 3.4): fetch the current ledger end first
	// so the snapshot is taken at "now" rather than ledger-begin (F4).
	offset, err := c.LedgerEnd(ctx, party)
	if err != nil {
		return nil, fmt.Errorf("ledger-end: %w", err)
	}
	reqBody := ActiveContractsRequest{
		Verbose:        true,
		ActiveAtOffset: offset,
		Filter: Filter{
			FiltersByParty: map[string]Filters{
				party: {Cumulative: filters},
			},
		},
	}
	body, err := c.rawPost(ctx, party, "/v2/state/active-contracts", reqBody)
	if err != nil {
		return nil, err
	}
	return parseACS(body)
}

// LedgerEnd returns the participant's current absolute ledger-end offset
// (GET /v2/state/ledger-end), used as activeAtOffset for ACS snapshots.
func (c *Client) LedgerEnd(ctx context.Context, party string) (int64, error) {
	var out LedgerEndResponse
	if err := c.do(ctx, party, http.MethodGet, "/v2/state/ledger-end", nil, &out); err != nil {
		return 0, err
	}
	return out.Offset, nil
}

// parseACS handles both the JSON-array and NDJSON stream encodings of the
// active-contracts response.
func parseACS(body []byte) ([]ActiveContract, error) {
	trimmed := bytes.TrimSpace(body)
	var out []ActiveContract
	if len(trimmed) > 0 && trimmed[0] == '[' {
		var envs []acsEnvelope
		if err := json.Unmarshal(trimmed, &envs); err != nil {
			return nil, fmt.Errorf("active-contracts decode: %w", err)
		}
		for _, e := range envs {
			if e.ActiveContract != nil {
				out = append(out, *e.ActiveContract)
			}
		}
		return out, nil
	}
	// NDJSON: one JSON object per line.
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	for {
		var e acsEnvelope
		if err := dec.Decode(&e); err != nil {
			if err == io.EOF {
				break
			}
			return nil, fmt.Errorf("active-contracts ndjson decode: %w", err)
		}
		if e.ActiveContract != nil {
			out = append(out, *e.ActiveContract)
		}
	}
	return out, nil
}

// AllocateParty allocates a new party (POST /v2/parties). Requires an admin
// JWT; on sandbox this is unauthenticated. actAsParty selects whose token is
// used ("" → no auth).
func (c *Client) AllocateParty(ctx context.Context, actAsParty, hint string) (string, error) {
	var out AllocatePartyResponse
	if err := c.do(ctx, actAsParty, http.MethodPost, "/v2/parties", AllocatePartyRequest{PartyIDHint: hint}, &out); err != nil {
		return "", err
	}
	return out.PartyDetails.Party, nil
}

// ---- transport helpers ----

func (c *Client) do(ctx context.Context, party, method, path string, in, out any) error {
	body, err := c.rawRequest(ctx, party, method, path, in)
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("%s %s decode: %w", method, path, err)
	}
	return nil
}

func (c *Client) rawPost(ctx context.Context, party, path string, in any) ([]byte, error) {
	return c.rawRequest(ctx, party, http.MethodPost, path, in)
}

func (c *Client) rawRequest(ctx context.Context, party, method, path string, in any) ([]byte, error) {
	var reqBody io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	if c.tokens != nil && party != "" {
		tok, err := c.tokens.TokenByParty(ctx, party)
		if err != nil {
			return nil, fmt.Errorf("token for %s: %w", party, err)
		}
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{StatusCode: resp.StatusCode, Body: string(respBody)}
	}
	return respBody, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
