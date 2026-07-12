package settle

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/registry"
	"github.com/showorsow/backend/internal/store"
)

// preflight (05 §4.1): query all StakedRSVP + live Allocations as appOperator;
// any staked RSVP whose allocation is inactive → MarkWithdrawn first and
// exclude it from settleItems.
func (r *Runner) preflight(ctx context.Context, ev *store.EventRow, opParty string) ([]StakedItem, error) {
	// Live StakedRSVP contracts visible to appOperator.
	acs, err := r.d.Ledger.ActiveContracts(ctx, opParty, []ledger.CumulativeFilter{{
		TemplateFilter: &ledger.TemplateFilter{
			TemplateID:              r.d.Pkg.TemplateID(ledger.TplStakedRSVP),
			IncludeCreatedEventBlob: true,
		},
	}})
	if err != nil {
		return nil, fmt.Errorf("query StakedRSVP: %w", err)
	}

	// Live Allocations visible to appOperator (by interface).
	allocs, err := r.d.Ledger.ActiveContracts(ctx, opParty, []ledger.CumulativeFilter{{
		InterfaceFilter: &ledger.InterfaceFilter{
			InterfaceID:          ledger.AllocationInterfaceID,
			IncludeInterfaceView: true,
		},
	}})
	if err != nil {
		return nil, fmt.Errorf("query Allocations: %w", err)
	}
	activeAllocs := map[string]bool{}
	for _, a := range allocs {
		activeAllocs[a.CreatedEvent.ContractID] = true
	}

	var items []StakedItem
	for _, ac := range acs {
		var sr stakedRSVPPayload
		if len(ac.CreatedEvent.CreateArguments) == 0 {
			continue
		}
		if err := json.Unmarshal(ac.CreatedEvent.CreateArguments, &sr); err != nil {
			continue
		}
		if sr.EventID != ev.EventID {
			continue // different event
		}
		if sr.Withdrawn {
			continue
		}
		allocCid := ""
		if sr.AllocationCid != nil {
			allocCid = *sr.AllocationCid
		}
		if allocCid == "" {
			// Never staked (allocationCid None) — nothing to settle.
			continue
		}
		// Allocation inactive → MarkWithdrawn and exclude.
		if !activeAllocs[allocCid] {
			if err := r.markWithdrawn(ctx, opParty, ac.CreatedEvent.ContractID); err != nil {
				r.logErr("preflight-markwithdrawn", err)
			}
			continue
		}
		items = append(items, StakedItem{
			RSVPCid:       ac.CreatedEvent.ContractID,
			AttendeeParty: sr.Attendee,
			SlotID:        sr.SlotID,
			AllocationCid: allocCid,
			CheckedIn:     sr.CheckedIn,
			StakeAmount:   ev.StakeAmount,
		})
	}
	return items, nil
}

// markWithdrawn exercises MarkWithdrawn as appOperator on a StakedRSVP.
func (r *Runner) markWithdrawn(ctx context.Context, opParty, rsvpCid string) error {
	cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
		TemplateID:     r.d.Pkg.TemplateID(ledger.TplStakedRSVP),
		ContractID:     rsvpCid,
		Choice:         "MarkWithdrawn",
		ChoiceArgument: json.RawMessage(`{}`),
	}}
	_, err := r.d.Ledger.SubmitAndWait(ctx, opParty, r.cmdID("markwithdrawn"), []ledger.Command{cmd}, nil)
	return err
}

// rsvpContext bundles the per-RSVP settle choice context + disclosed contracts.
type rsvpContext struct {
	extraArgs          json.RawMessage
	disclosedContracts []ledger.DisclosedContract
}

// buildSettleItems (05 §4.4): per remaining RSVP fetch the Settle choice
// context — execute-transfer for ghosts, cancel for checked-in — and assemble
// the (rsvpCid, extraArgs) settleItems payloads.
func (r *Runner) buildSettleItems(ctx context.Context, ev *store.EventRow, items []StakedItem) ([]settleItem, map[string]rsvpContext, error) {
	// Demo-token mode (05 §6c / 04 §1.7): a pure-Daml demo token has no registry
	// HTTP API — skip the per-RSVP ChoiceContext fetch entirely and pass an empty
	// ExtraArgs with no disclosed contracts. The DemoAllocation choices
	// (ExecuteTransfer / Cancel) that CloseEvent drives need no off-ledger
	// context, so settlement runs entirely on-ledger.
	demo := r.d.Cfg != nil && r.d.Cfg.IsDemoToken(ev.InstrumentAdmin, ev.InstrumentID)

	var rc *registry.Client
	if !demo {
		var err error
		rc, err = r.d.Registry(ev.InstrumentAdmin, ev.InstrumentID)
		if err != nil {
			return nil, nil, fmt.Errorf("registry client: %w", err)
		}
	}

	ctxByRsvp := map[string]rsvpContext{}
	var out []settleItem
	for _, it := range items {
		var cc registry.ChoiceContext
		if demo {
			cc = registry.DemoChoiceContext()
		} else {
			kind := "execute-transfer" // ghost → slash
			if it.CheckedIn {
				kind = "cancel" // checked-in → refund
			}
			var err error
			cc, err = rc.AllocationChoiceContext(ctx, it.AllocationCid, kind)
			if err != nil {
				return nil, nil, fmt.Errorf("choice-context %s for %s: %w", kind, ledger.ShortCid(it.AllocationCid), err)
			}
		}
		extra := cc.ExtraArgs
		if len(extra) == 0 {
			// Fall back to wrapping the raw choiceContextData as ExtraArgs
			// {context, meta}.
			extra = wrapExtraArgs(cc.ChoiceContextData)
		}
		ctxByRsvp[it.RSVPCid] = rsvpContext{extraArgs: extra, disclosedContracts: cc.DisclosedContracts}
		out = append(out, settleItem{rsvpCid: it.RSVPCid, extraArgs: extra, disclosed: cc.DisclosedContracts})
	}
	return out, ctxByRsvp, nil
}

// settleItem is one element of the CloseEvent settleItems list.
type settleItem struct {
	rsvpCid   string
	extraArgs json.RawMessage
	disclosed []ledger.DisclosedContract
}

// closePrimary (05 §4.5 primary): one Event.CloseEvent(settleItems) exercise —
// atomic. The settleItems argument is a list of (ContractId StakedRSVP,
// ExtraArgs) pairs.
func (r *Runner) closePrimary(ctx context.Context, opParty, eventCid string, items []settleItem) error {
	arg, disclosed := buildCloseEventArg(items)
	cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
		TemplateID:     r.d.Pkg.TemplateID(ledger.TplEvent),
		ContractID:     eventCid,
		Choice:         "CloseEvent",
		ChoiceArgument: arg,
	}}
	_, err := r.d.Ledger.SubmitAndWait(ctx, opParty, r.cmdID("closeevent"), []ledger.Command{cmd}, disclosed)
	return err
}

// closeSequential (05 §4.5 fallback / 09 R6): CloseEvent once per RSVP with a
// single-item settleItems list, behind the SETTLE_SEQUENTIAL_FALLBACK flag.
func (r *Runner) closeSequential(ctx context.Context, opParty, eventCid string, items []settleItem, _ map[string]rsvpContext) error {
	for _, it := range items {
		arg, disclosed := buildCloseEventArg([]settleItem{it})
		cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     r.d.Pkg.TemplateID(ledger.TplEvent),
			ContractID:     eventCid,
			Choice:         "CloseEvent",
			ChoiceArgument: arg,
		}}
		if _, err := r.d.Ledger.SubmitAndWait(ctx, opParty, r.cmdID("closeevent-seq"), []ledger.Command{cmd}, disclosed); err != nil {
			return fmt.Errorf("sequential CloseEvent for %s: %w", ledger.ShortCid(it.rsvpCid), err)
		}
	}
	return nil
}

// buildCloseEventArg builds the CloseEvent choice argument: a settleItems list
// of tuples [rsvpCid, extraArgs] and the merged disclosed-contracts set.
func buildCloseEventArg(items []settleItem) (json.RawMessage, []ledger.DisclosedContract) {
	type tuple struct {
		Field1 string          `json:"_1"`
		Field2 json.RawMessage `json:"_2"`
	}
	tuples := make([]tuple, 0, len(items))
	var disclosed []ledger.DisclosedContract
	seen := map[string]bool{}
	for _, it := range items {
		ea := it.extraArgs
		if len(ea) == 0 {
			// Empty ChoiceContext is {"values":{}} (a record, not Optional) — a
			// null context fails the Daml JSON decode of CloseEvent (F9).
			ea = json.RawMessage(`{"context":{"values":{}},"meta":{"values":{}}}`)
		}
		tuples = append(tuples, tuple{Field1: it.rsvpCid, Field2: ea})
		for _, d := range it.disclosed {
			if !seen[d.ContractID] {
				seen[d.ContractID] = true
				disclosed = append(disclosed, d)
			}
		}
	}
	arg, _ := json.Marshal(map[string]any{"settleItems": tuples})
	return arg, disclosed
}

// wrapExtraArgs wraps a bare choiceContextData value into the ExtraArgs record
// {context, meta} the token-standard choices expect.
func wrapExtraArgs(contextData json.RawMessage) json.RawMessage {
	if len(contextData) == 0 {
		// ExtraArgs.context is a ChoiceContext record, not Optional — empty is
		// {"values":{}}, never null (F9).
		contextData = json.RawMessage(`{"values":{}}`)
	}
	b, _ := json.Marshal(map[string]any{
		"context": json.RawMessage(contextData),
		"meta":    map[string]any{"values": map[string]any{}},
	})
	return b
}

// stakedRSVPPayload is the subset of the StakedRSVP create-argument record the
// runner reads. Field names match the Daml record (04 §1.4).
type stakedRSVPPayload struct {
	Organizer       string  `json:"organizer"`
	AppOperator     string  `json:"appOperator"`
	Attendee        string  `json:"attendee"`
	EventID         string  `json:"eventId"`
	SlotID          string  `json:"slotId"`
	StakeAmount     string  `json:"stakeAmount"`
	InstrumentAdmin string  `json:"instrumentAdmin"`
	InstrumentID    string  `json:"instrumentId"`
	AllocationCid   *string `json:"allocationCid"`
	CheckedIn       bool    `json:"checkedIn"`
	Withdrawn       bool    `json:"withdrawn"`
}
