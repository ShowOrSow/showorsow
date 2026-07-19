package ledger

import "encoding/json"

// This file holds the wire types for JSON Ledger API v2. Shapes follow the
// canton 3.x JSON API v2 (docs.digitalasset.com /build/3.4). Only the fields
// the backend needs are modelled; unknown fields are ignored on decode.

// ---- Commands ----

// Command is one create/exercise command in a submission.
type Command struct {
	CreateCommand   *CreateCommand   `json:"CreateCommand,omitempty"`
	ExerciseCommand *ExerciseCommand `json:"ExerciseCommand,omitempty"`
}

// CreateCommand creates a contract from a template + record payload.
type CreateCommand struct {
	TemplateID      string          `json:"templateId"`
	CreateArguments json.RawMessage `json:"createArguments"`
}

// ExerciseCommand exercises a choice on an existing contract.
type ExerciseCommand struct {
	TemplateID     string          `json:"templateId"`
	ContractID     string          `json:"contractId"`
	Choice         string          `json:"choice"`
	ChoiceArgument json.RawMessage `json:"choiceArgument"`
}

// DisclosedContract carries a contract's blob for registry choices where the
// exercising party is not a stakeholder (03 §4).
type DisclosedContract struct {
	TemplateID       string `json:"templateId"`
	ContractID       string `json:"contractId"`
	CreatedEventBlob string `json:"createdEventBlob"`
	SynchronizerID   string `json:"synchronizerId,omitempty"`
}

// JsCommands is the inner command batch. On submit-and-wait-for-transaction it
// is NESTED under the top-level "commands" key of the request (Canton 3.4:
// JsSubmitAndWaitForTransactionRequest = {commands: <JsCommands>,
// transactionFormat: <TransactionFormat>}).
type JsCommands struct {
	Commands           []Command           `json:"commands"`
	CommandID          string              `json:"commandId"`
	ActAs              []string            `json:"actAs"`
	ReadAs             []string            `json:"readAs,omitempty"`
	UserID             string              `json:"userId,omitempty"`
	DisclosedContracts []DisclosedContract `json:"disclosedContracts,omitempty"`
	SynchronizerID     string              `json:"synchronizerId,omitempty"`
}

// SubmitAndWaitForTransactionRequest is the body of POST
// /v2/commands/submit-and-wait-for-transaction (Canton 3.4). The command batch
// is nested under "commands"; "transactionFormat" selects the returned events —
// interface views only come back when their interface is requested here (F5).
type SubmitAndWaitForTransactionRequest struct {
	Commands          JsCommands        `json:"commands"`
	TransactionFormat TransactionFormat `json:"transactionFormat"`
}

// TransactionFormat selects the shape + event projection of the returned
// transaction.
type TransactionFormat struct {
	EventFormat      EventFormat `json:"eventFormat"`
	TransactionShape string      `json:"transactionShape"`
}

// EventFormat mirrors the active-contracts filter: per-party cumulative filters
// plus verbose. Requesting an InterfaceFilter with includeInterfaceView here is
// what makes created contracts carry interfaceViews in the result.
type EventFormat struct {
	FiltersByParty     map[string]Filters `json:"filtersByParty,omitempty"`
	FiltersForAnyParty *Filters           `json:"filtersForAnyParty,omitempty"`
	Verbose            bool               `json:"verbose"`
}

// SubmitAndWaitForTransactionResponse — we request the transaction tree so we
// can pull created/exercised contract ids out of the result (needed by
// EndEventEarly which yields the new Event cid, and by create commands).
type SubmitAndWaitResponse struct {
	Transaction Transaction `json:"transaction"`
	// Some deployments return a bare TransactionTree; both are captured.
	TransactionTree json.RawMessage `json:"transactionTree,omitempty"`
	UpdateID        string          `json:"updateId,omitempty"`
}

// Transaction is the flattened transaction with its top-level events.
type Transaction struct {
	UpdateID string  `json:"updateId"`
	Offset   any     `json:"offset"`
	Events   []Event `json:"events"`
}

// Event is one node in a transaction (created or exercised/archived).
type Event struct {
	Created   *CreatedEvent   `json:"CreatedEvent,omitempty"`
	Archived  *ArchivedEvent  `json:"ArchivedEvent,omitempty"`
	Exercised *ExercisedEvent `json:"ExercisedEvent,omitempty"`
}

// CreatedEvent describes a created contract.
type CreatedEvent struct {
	ContractID       string          `json:"contractId"`
	TemplateID       string          `json:"templateId"`
	CreateArguments  json.RawMessage `json:"createArgument,omitempty"`
	CreatedEventBlob string          `json:"createdEventBlob,omitempty"`
	InterfaceViews   []InterfaceView `json:"interfaceViews,omitempty"`
}

// ArchivedEvent describes an archived contract.
type ArchivedEvent struct {
	ContractID string `json:"contractId"`
	TemplateID string `json:"templateId"`
}

// ExercisedEvent describes an exercised choice; exerciseResult may carry the
// choice's return value (e.g. a recreated contract id).
type ExercisedEvent struct {
	ContractID     string          `json:"contractId"`
	TemplateID     string          `json:"templateId"`
	Choice         string          `json:"choice"`
	ExerciseResult json.RawMessage `json:"exerciseResult,omitempty"`
	Consuming      bool            `json:"consuming"`
}

// ---- Active contracts ----

// ActiveContractsRequest is the body of POST /v2/state/active-contracts.
// activeAtOffset is REQUIRED in Canton 3.3+/3.4 (int64 absolute offset, normally
// the current ledger end); omitting it yields a 400 or an empty snapshot at
// ledger-begin (F4).
type ActiveContractsRequest struct {
	Filter         Filter `json:"filter"`
	Verbose        bool   `json:"verbose"`
	ActiveAtOffset int64  `json:"activeAtOffset"`
}

// LedgerEndResponse is the body of GET /v2/state/ledger-end: a single int64
// absolute offset (0 = participant begin, first valid write = 1).
type LedgerEndResponse struct {
	Offset int64 `json:"offset"`
}

// Filter selects templates/interfaces per party.
type Filter struct {
	FiltersByParty     map[string]Filters `json:"filtersByParty,omitempty"`
	FiltersForAnyParty *Filters           `json:"filtersForAnyParty,omitempty"`
}

// Filters is the cumulative filter for one party.
type Filters struct {
	Cumulative []CumulativeFilter `json:"cumulative"`
}

// CumulativeFilter is one filter identifier (template or interface). On the wire
// (Canton 3.4) each entry is {"identifierFilter": {"<Kind>Filter": {"value":
// {...}}}}; the custom MarshalJSON emits that nesting so call sites stay flat.
type CumulativeFilter struct {
	TemplateFilter  *TemplateFilter  `json:"-"`
	InterfaceFilter *InterfaceFilter `json:"-"`
	WildcardFilter  *WildcardFilter  `json:"-"`
}

// MarshalJSON emits the verified identifierFilter/value nesting.
func (c CumulativeFilter) MarshalJSON() ([]byte, error) {
	type valueWrap struct {
		Value any `json:"value"`
	}
	inner := map[string]valueWrap{}
	switch {
	case c.InterfaceFilter != nil:
		inner["InterfaceFilter"] = valueWrap{Value: c.InterfaceFilter}
	case c.TemplateFilter != nil:
		inner["TemplateFilter"] = valueWrap{Value: c.TemplateFilter}
	case c.WildcardFilter != nil:
		inner["WildcardFilter"] = valueWrap{Value: c.WildcardFilter}
	}
	return json.Marshal(map[string]any{"identifierFilter": inner})
}

type TemplateFilter struct {
	TemplateID              string `json:"templateId"`
	IncludeCreatedEventBlob bool   `json:"includeCreatedEventBlob"`
}

type InterfaceFilter struct {
	InterfaceID             string `json:"interfaceId"`
	IncludeInterfaceView    bool   `json:"includeInterfaceView"`
	IncludeCreatedEventBlob bool   `json:"includeCreatedEventBlob"`
}

type WildcardFilter struct {
	IncludeCreatedEventBlob bool `json:"includeCreatedEventBlob"`
}

// InterfaceView is the decoded interface projection on a created contract.
type InterfaceView struct {
	InterfaceID string          `json:"interfaceId"`
	ViewValue   json.RawMessage `json:"viewValue,omitempty"`
	ViewStatus  json.RawMessage `json:"viewStatus,omitempty"`
}

// ActiveContract is one row of the active-contracts response.
type ActiveContract struct {
	CreatedEvent   CreatedEvent `json:"createdEvent"`
	SynchronizerID string       `json:"synchronizerId,omitempty"`
}

// acsEnvelope wraps each streamed active-contracts entry. Canton 3.5 nests the
// active contract under contractEntry.JsActiveContract (a JsContractEntry sum
// type); older previews used a flat "activeContract". We accept both.
// IncompleteAssigned / IncompleteUnassigned are ignored for demo scale.
type acsEnvelope struct {
	ContractEntry  contractEntry   `json:"contractEntry,omitempty"`
	ActiveContract *ActiveContract `json:"activeContract,omitempty"` // legacy flat shape
}

// contractEntry is the Canton 3.5 JsContractEntry wrapper; only the active
// variant carries a contract we project.
type contractEntry struct {
	JsActiveContract *ActiveContract `json:"JsActiveContract,omitempty"`
}

// ac returns the effective ActiveContract from either shape, or nil.
func (e acsEnvelope) ac() *ActiveContract {
	if e.ContractEntry.JsActiveContract != nil {
		return e.ContractEntry.JsActiveContract
	}
	return e.ActiveContract
}

// ---- Parties ----

// AllocatePartyRequest is the body of POST /v2/parties.
type AllocatePartyRequest struct {
	PartyIDHint string `json:"partyIdHint,omitempty"`
	// identityProviderId omitted (default IdP).
}

// AllocatePartyResponse carries the allocated party details.
type AllocatePartyResponse struct {
	PartyDetails PartyDetails `json:"partyDetails"`
}

type PartyDetails struct {
	Party         string          `json:"party"`
	IsLocal       bool            `json:"isLocal"`
	LocalMetadata json.RawMessage `json:"localMetadata,omitempty"`
}
