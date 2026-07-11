// Package registry is a plain net/http client for the CIP-56 token-standard
// registry OpenAPI (metadata, allocation choice-contexts, transfer-factory).
// Each factory/choice-context call returns {factoryCid?, extraArgs,
// disclosedContracts} (05 §1). No custody is ever taken by this backend.
package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/showorsow/backend/internal/ledger"
)

// Client is a registry client bound to one registry base URL. The base URL is
// per-token (03 §6): .../registrars/{admin}/registry.
type Client struct {
	baseURL string
	hc      *http.Client
}

// New builds a registry Client for a base URL.
func New(baseURL string, hc *http.Client) *Client {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), hc: hc}
}

// APIError is a non-2xx registry response.
type APIError struct {
	StatusCode int
	Body       string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("registry api status %d: %s", e.StatusCode, e.Body)
}

// ---- Metadata (.../registry/metadata/v1/instruments) ----

// Instrument is one registry-advertised instrument with live decimals.
type Instrument struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	Symbol   string `json:"symbol,omitempty"`
	Decimals int    `json:"decimals"`
}

type instrumentsResp struct {
	Instruments []Instrument `json:"instruments"`
}

// InstrumentMetadata fetches the registry instrument list. decimals are read
// live here — never hardcoded (03 §1).
func (c *Client) InstrumentMetadata(ctx context.Context) ([]Instrument, error) {
	body, err := c.get(ctx, "/registry/metadata/v1/instruments")
	if err != nil {
		return nil, err
	}
	var r instrumentsResp
	if err := json.Unmarshal(body, &r); err != nil {
		// Some registries return a bare array.
		var arr []Instrument
		if err2 := json.Unmarshal(body, &arr); err2 == nil {
			return arr, nil
		}
		return nil, fmt.Errorf("instruments decode: %w", err)
	}
	return r.Instruments, nil
}

// Decimals returns the decimals for a specific instrument id.
func (c *Client) Decimals(ctx context.Context, instrumentID string) (int, error) {
	insts, err := c.InstrumentMetadata(ctx)
	if err != nil {
		return 0, err
	}
	for _, in := range insts {
		if in.ID == instrumentID {
			return in.Decimals, nil
		}
	}
	return 0, fmt.Errorf("instrument %q not found in registry metadata", instrumentID)
}

// ---- Choice context result (common shape) ----

// ChoiceContext is the {factoryCid?, extraArgs, disclosedContracts} triple
// returned by factory-discovery and choice-context endpoints (05 §1).
type ChoiceContext struct {
	FactoryID          string                     `json:"factoryId,omitempty"`
	ExtraArgs          json.RawMessage            `json:"extraArgs,omitempty"`
	ChoiceContextData  json.RawMessage            `json:"choiceContextData,omitempty"`
	DisclosedContracts []ledger.DisclosedContract `json:"disclosedContracts,omitempty"`
}

// registryChoiceContextResp is the raw registry envelope. The token-standard
// registries return choiceContextData + disclosedContracts; factory endpoints
// additionally return factoryId. We normalise both into ChoiceContext.
type registryChoiceContextResp struct {
	FactoryID           string          `json:"factoryId,omitempty"`
	TransferFactoryID   string          `json:"transferFactoryId,omitempty"`
	AllocationFactoryID string          `json:"allocationFactoryId,omitempty"`
	ChoiceContext       json.RawMessage `json:"choiceContext,omitempty"`
	ChoiceContextData   json.RawMessage `json:"choiceContextData,omitempty"`
	ExtraArgs           json.RawMessage `json:"extraArgs,omitempty"`
	DisclosedContracts  []rawDisclosed  `json:"disclosedContracts,omitempty"`
}

// rawDisclosed accommodates both createdEventBlob and blob field names.
type rawDisclosed struct {
	TemplateID       string `json:"templateId"`
	ContractID       string `json:"contractId"`
	CreatedEventBlob string `json:"createdEventBlob"`
	Blob             string `json:"blob"`
	SynchronizerID   string `json:"synchronizerId"`
}

func (r *registryChoiceContextResp) toChoiceContext() ChoiceContext {
	cc := ChoiceContext{
		ExtraArgs:         r.ExtraArgs,
		ChoiceContextData: firstRaw(r.ChoiceContextData, r.ChoiceContext),
	}
	switch {
	case r.FactoryID != "":
		cc.FactoryID = r.FactoryID
	case r.TransferFactoryID != "":
		cc.FactoryID = r.TransferFactoryID
	case r.AllocationFactoryID != "":
		cc.FactoryID = r.AllocationFactoryID
	}
	for _, d := range r.DisclosedContracts {
		blob := d.CreatedEventBlob
		if blob == "" {
			blob = d.Blob
		}
		cc.DisclosedContracts = append(cc.DisclosedContracts, ledger.DisclosedContract{
			TemplateID:       d.TemplateID,
			ContractID:       d.ContractID,
			CreatedEventBlob: blob,
			SynchronizerID:   d.SynchronizerID,
		})
	}
	return cc
}

func firstRaw(a, b json.RawMessage) json.RawMessage {
	if len(a) > 0 {
		return a
	}
	return b
}

// ---- Allocation factory discovery + Allocate choice context ----

// allocationFactoryReq mirrors the token-standard allocation-factory request:
// the AllocationRequest cid the sender is answering, the choice arguments, and
// the requesting party.
type allocationFactoryReq struct {
	// choiceArguments carries the AllocationFactory_Allocate args (the
	// AllocationSpecification derived from the AllocationRequest view).
	ChoiceArguments    json.RawMessage `json:"choiceArguments,omitempty"`
	ExcludeDebugFields bool            `json:"excludeDebugFields,omitempty"`
}

// AllocationFactoryDiscovery fetches the AllocationFactory + Allocate choice
// context for a sender answering an AllocationRequest. `choiceArgs` is the
// caller-built AllocationFactory_Allocate argument record (allocation spec).
func (c *Client) AllocationFactoryDiscovery(ctx context.Context, choiceArgs json.RawMessage) (ChoiceContext, error) {
	body, err := c.post(ctx, "/registry/allocations/v1/allocation-factory", allocationFactoryReq{
		ChoiceArguments: choiceArgs,
	})
	if err != nil {
		return ChoiceContext{}, err
	}
	var r registryChoiceContextResp
	if err := json.Unmarshal(body, &r); err != nil {
		return ChoiceContext{}, fmt.Errorf("allocation-factory decode: %w", err)
	}
	return r.toChoiceContext(), nil
}

// AllocationChoiceContext fetches the choice context for a lifecycle choice on
// an existing Allocation: kind ∈ {"execute-transfer", "cancel"} — used at
// settlement (05 §4) via GET/POST
// /registry/allocations/v1/{allocationId}/choice-contexts/{kind}.
func (c *Client) AllocationChoiceContext(ctx context.Context, allocationID, kind string) (ChoiceContext, error) {
	path := fmt.Sprintf("/registry/allocations/v1/%s/choice-contexts/%s", allocationID, kind)
	body, err := c.post(ctx, path, map[string]any{})
	if err != nil {
		return ChoiceContext{}, err
	}
	var r registryChoiceContextResp
	if err := json.Unmarshal(body, &r); err != nil {
		return ChoiceContext{}, fmt.Errorf("allocation choice-context decode: %w", err)
	}
	return r.toChoiceContext(), nil
}

// ---- Transfer factory (payouts) ----

// transferFactoryReq mirrors the token-standard transfer-factory request. The
// expectedAdmin field is REQUIRED (03 §4).
type transferFactoryReq struct {
	ExpectedAdmin      string          `json:"expectedAdmin"`
	ChoiceArguments    json.RawMessage `json:"choiceArguments,omitempty"`
	ExcludeDebugFields bool            `json:"excludeDebugFields,omitempty"`
}

// TransferFactory fetches the TransferFactory + transfer choice context for a
// pot → recipient payout. `choiceArgs` is the TransferFactory_Transfer arg
// record (with the meta stamp already embedded by the caller, 05 §5).
func (c *Client) TransferFactory(ctx context.Context, expectedAdmin string, choiceArgs json.RawMessage) (ChoiceContext, error) {
	body, err := c.post(ctx, "/registry/transfer-instruction/v1/transfer-factory", transferFactoryReq{
		ExpectedAdmin:   expectedAdmin,
		ChoiceArguments: choiceArgs,
	})
	if err != nil {
		return ChoiceContext{}, err
	}
	var r registryChoiceContextResp
	if err := json.Unmarshal(body, &r); err != nil {
		return ChoiceContext{}, fmt.Errorf("transfer-factory decode: %w", err)
	}
	return r.toChoiceContext(), nil
}

// TransferInstructionChoiceContext fetches the accept/reject/withdraw choice
// context for a pending TransferInstruction (payout two-step accept, 05 §5).
func (c *Client) TransferInstructionChoiceContext(ctx context.Context, instructionID, kind string) (ChoiceContext, error) {
	path := fmt.Sprintf("/registry/transfer-instruction/v1/%s/choice-contexts/%s", instructionID, kind)
	body, err := c.post(ctx, path, map[string]any{})
	if err != nil {
		return ChoiceContext{}, err
	}
	var r registryChoiceContextResp
	if err := json.Unmarshal(body, &r); err != nil {
		return ChoiceContext{}, fmt.Errorf("transfer-instruction choice-context decode: %w", err)
	}
	return r.toChoiceContext(), nil
}

// ---- transport ----

func (c *Client) get(ctx context.Context, path string) ([]byte, error) {
	return c.do(ctx, http.MethodGet, path, nil)
}

func (c *Client) post(ctx context.Context, path string, in any) ([]byte, error) {
	return c.do(ctx, http.MethodPost, path, in)
}

func (c *Client) do(ctx context.Context, method, path string, in any) ([]byte, error) {
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
	req.Header.Set("Accept", "application/json")
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{StatusCode: resp.StatusCode, Body: string(body)}
	}
	return body, nil
}
