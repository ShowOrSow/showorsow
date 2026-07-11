// Package settle holds the settlement runner (05 §4), payout runner (05 §5),
// balance snapshots (05 §6) and the withdrawal watcher (05 §7). It is the only
// place that orchestrates the multi-step ledger settlement flow.
package settle

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/showorsow/backend/internal/config"
	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/personas"
	"github.com/showorsow/backend/internal/registry"
	"github.com/showorsow/backend/internal/store"
)

// Deps bundles the collaborators the runners need.
type Deps struct {
	Cfg       *config.Config
	Ledger    *ledger.Client
	Personas  *personas.Manager
	Store     *store.Store
	Pkg       ledger.PackageQualifier
	NewIDFunc func() string // unique command-id generator
	// Registry returns a registry client for a given (admin, instrumentId).
	Registry func(admin, instrumentID string) (*registry.Client, error)
	// Errorf logs a structured error with a searchable errorId.
	Errorf func(errorID, stage string, err error)
}

// StakedItem is a staked RSVP participating in settlement.
type StakedItem struct {
	RSVPCid       string
	AttendeeParty string
	SlotID        string
	AllocationCid string
	CheckedIn     bool
	StakeAmount   string
}

// SettlementResult is the response package for POST .../close (05 §4.7).
type SettlementResult struct {
	Settlements []SettlementEntry `json:"settlements"`
	Payouts     []PayoutEntry     `json:"payouts"`
	Deltas      []DeltaEntry      `json:"deltas"`
}

// SettlementEntry describes one RSVP outcome. attendeeLabel is the persona label
// (join key with deltas[].party — architect cross-component pin), not the party id.
type SettlementEntry struct {
	AttendeeLabel string `json:"attendeeLabel"`
	SlotID        string `json:"slotId"`
	Outcome       string `json:"outcome"` // refund | slash | withdrawn
	Amount        string `json:"amount"`
}

// PayoutEntry describes one pot → recipient transfer.
type PayoutEntry struct {
	RecipientParty string `json:"party"`
	Amount         string `json:"amount"`
	TransferCid    string `json:"transferCid"`
}

// DeltaEntry is a before/after balance pair.
type DeltaEntry struct {
	Party  string `json:"party"`
	Before string `json:"before"`
	After  string `json:"after"`
}

// Runner executes the settlement flow for one event.
type Runner struct {
	d Deps
}

// NewRunner constructs a settlement Runner.
func NewRunner(d Deps) *Runner { return &Runner{d: d} }

// Close runs the full settlement flow in the exact spec order (05 §4):
// pre-flight → before-snapshots → EndEventEarly → contexts → CloseEvent
// (primary or sequential fallback) → payouts → after-snapshots → MarkSettled.
func (r *Runner) Close(ctx context.Context, ev *store.EventRow) (*SettlementResult, error) {
	op := r.d.Cfg.AppOperatorPersona
	opParty, ok := r.d.Personas.Party(op)
	if !ok {
		return nil, fmt.Errorf("appOperator persona %q not configured", op)
	}
	orgParty := ev.OrganizerParty

	// 1. Pre-flight: live-query staked RSVPs + live allocations as appOperator;
	// any staked RSVP whose allocation is inactive → MarkWithdrawn first and
	// exclude from settleItems.
	items, err := r.preflight(ctx, ev, opParty)
	if err != nil {
		return nil, fmt.Errorf("preflight: %w", err)
	}

	res := &SettlementResult{}

	// Parties whose balances we snapshot: every settling attendee (with their
	// own JWT, 05 §6).
	snapParties := uniqueAttendees(items)

	// 2. before snapshots.
	if err := r.snapshot(ctx, ev, snapParties, store.PhaseBefore); err != nil {
		r.logErr("before-snapshot", err)
	}

	// 3. EndEventEarly as organizer → new Event cid from the tx result.
	newEventCid, err := r.endEventEarly(ctx, ev, orgParty)
	if err != nil {
		return nil, fmt.Errorf("EndEventEarly: %w", err)
	}

	// 4. Per remaining RSVP: fetch ChoiceContext — execute-transfer (ghosts) /
	// cancel (checked-in). 5. CloseEvent primary or sequential fallback.
	settleItems, ctxByRsvp, err := r.buildSettleItems(ctx, ev, items)
	if err != nil {
		return nil, err
	}

	if r.d.Cfg.SequentialSettle {
		err = r.closeSequential(ctx, opParty, newEventCid, settleItems, ctxByRsvp)
	} else {
		err = r.closePrimary(ctx, opParty, newEventCid, settleItems)
	}
	if err != nil {
		return nil, fmt.Errorf("CloseEvent: %w", err)
	}

	// settlement entries (mirrors the ledger outcome; source of truth is the
	// indexer, 05 §4.7). `attendeeLabel` is the PERSONA LABEL — the cross-
	// component join key with deltas[].party (architect pin), never the party id.
	for _, it := range items {
		outcome := "slash"
		if it.CheckedIn {
			outcome = "refund"
		}
		res.Settlements = append(res.Settlements, SettlementEntry{
			AttendeeLabel: r.labelFor(it.AttendeeParty),
			SlotID:        it.SlotID,
			Outcome:       outcome,
			Amount:        ev.StakeAmount,
		})
	}

	// 6a. Payout runner §5.
	payouts, err := r.runPayouts(ctx, ev, opParty, items)
	if err != nil {
		// Payout failure is logged but does not abort — the slash already
		// landed in the pot; the pot simply retains funds. MarkSettled must
		// still run so RSVPs are not stranded.
		r.logErr("payout", err)
	}
	res.Payouts = payouts

	// 6b. after snapshots.
	if err := r.snapshot(ctx, ev, snapParties, store.PhaseAfter); err != nil {
		r.logErr("after-snapshot", err)
	}

	// 6c. MarkSettled strictly last.
	if err := r.markSettled(ctx, opParty, newEventCid); err != nil {
		return res, fmt.Errorf("MarkSettled: %w", err)
	}

	// deltas from the snapshots just written. `party` is the PERSONA LABEL (the
	// join key the web SettlementResults matches against settlements[].attendeeLabel,
	// architect pin) — map the raw party id back to its persona label.
	deltas, err := r.d.Store.GetBalanceDeltas(ctx, ev.EventID)
	if err == nil {
		for _, dRow := range deltas {
			res.Deltas = append(res.Deltas, DeltaEntry{Party: r.labelFor(dRow.Party), Before: dRow.Before, After: dRow.After})
		}
	}

	return res, nil
}

// labelFor maps a Canton party id back to its persona label (e.g. "alice") for
// the settlement/close response. Falls back to the raw party id if unconfigured.
func (r *Runner) labelFor(party string) string {
	if p, ok := r.d.Cfg.PersonaByParty(party); ok {
		return p.Name
	}
	return party
}

// endEventEarly exercises EndEventEarly as organizer and returns the recreated
// Event cid from the transaction result (don't wait for the indexer, 05 §4.3).
func (r *Runner) endEventEarly(ctx context.Context, ev *store.EventRow, organizer string) (string, error) {
	cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
		TemplateID:     r.d.Pkg.TemplateID(ledger.TplEvent),
		ContractID:     ev.ContractID,
		Choice:         "EndEventEarly",
		ChoiceArgument: json.RawMessage(`{}`),
	}}
	resp, err := r.d.Ledger.SubmitAndWait(ctx, organizer, r.cmdID("endevent"), []ledger.Command{cmd}, nil)
	if err != nil {
		return "", err
	}
	cid, ok := resp.CreatedByTemplate(ledger.TplEvent)
	if !ok {
		return "", fmt.Errorf("EndEventEarly produced no recreated Event")
	}
	return cid, nil
}

// markSettled archives the Event (strictly last, 05 §4.6).
func (r *Runner) markSettled(ctx context.Context, opParty, eventCid string) error {
	cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
		TemplateID:     r.d.Pkg.TemplateID(ledger.TplEvent),
		ContractID:     eventCid,
		Choice:         "MarkSettled",
		ChoiceArgument: json.RawMessage(`{}`),
	}}
	_, err := r.d.Ledger.SubmitAndWait(ctx, opParty, r.cmdID("marksettled"), []ledger.Command{cmd}, nil)
	return err
}

func (r *Runner) cmdID(prefix string) string {
	if r.d.NewIDFunc != nil {
		return prefix + "-" + r.d.NewIDFunc()
	}
	return prefix
}

func (r *Runner) logErr(stage string, err error) {
	if r.d.Errorf != nil {
		r.d.Errorf(r.cmdID("err"), stage, err)
	}
}

func (r *Runner) decimalsFor(ctx context.Context, ev *store.EventRow) (int, error) {
	rc, err := r.d.Registry(ev.InstrumentAdmin, ev.InstrumentID)
	if err != nil {
		return 0, err
	}
	return rc.Decimals(ctx, ev.InstrumentID)
}

func uniqueAttendees(items []StakedItem) []string {
	seen := map[string]bool{}
	var out []string
	for _, it := range items {
		if !seen[it.AttendeeParty] {
			seen[it.AttendeeParty] = true
			out = append(out, it.AttendeeParty)
		}
	}
	return out
}
