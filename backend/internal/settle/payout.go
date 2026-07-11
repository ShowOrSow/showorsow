package settle

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"

	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/registry"
	"github.com/showorsow/backend/internal/store"
)

// runPayouts is the payout runner (05 §5): pot → checked-in attendees.
//
//  1. slashedTotal = ghostCount × stake; if numCheckedIn == 0 || slashedTotal
//     == 0 → skip entirely (pot keeps funds).
//  2. share = floor(slashedTotal / numCheckedIn, decimals); dust stays in pot.
//  3. Per recipient: TransferFactory_Transfer as appOperator with
//     meta["showorsow.dev/event"] = eventId/slotId; then auto-accept as the
//     recipient user party.
func (r *Runner) runPayouts(ctx context.Context, ev *store.EventRow, opParty string, items []StakedItem) ([]PayoutEntry, error) {
	var ghostCount, checkedInCount int
	var checkedIn []StakedItem
	for _, it := range items {
		if it.CheckedIn {
			checkedInCount++
			checkedIn = append(checkedIn, it)
		} else {
			ghostCount++
		}
	}

	stake, ok := new(big.Rat).SetString(ev.StakeAmount)
	if !ok {
		return nil, fmt.Errorf("bad stake amount %q", ev.StakeAmount)
	}
	slashedTotal := new(big.Rat).Mul(stake, big.NewRat(int64(ghostCount), 1))

	// Zero-guards: skip entirely.
	if checkedInCount == 0 || slashedTotal.Sign() == 0 {
		return nil, nil
	}

	// Fetch registry decimals only now, AFTER the zero-guards: settlement
	// (refund/slash) never needs decimals, so a registry-metadata outage must
	// degrade payouts alone, not abort the whole settlement (F12).
	decimals, err := r.decimalsFor(ctx, ev)
	if err != nil {
		r.logErr("payout-decimals", err)
		return nil, nil
	}

	share := floorDiv(slashedTotal, int64(checkedInCount), decimals)
	if share.Sign() == 0 {
		// Every share floors to zero — dust stays in pot, no payouts.
		return nil, nil
	}
	shareStr := ratToDecimalString(share, decimals)

	rc, err := r.d.Registry(ev.InstrumentAdmin, ev.InstrumentID)
	if err != nil {
		return nil, err
	}

	var out []PayoutEntry
	for _, it := range checkedIn {
		entry, err := r.transferOne(ctx, rc, ev, opParty, it, shareStr)
		if err != nil {
			// Log and continue: one failed payout must not strand the rest or
			// block MarkSettled.
			r.logErr("payout-transfer", err)
			continue
		}
		out = append(out, entry)
	}
	return out, nil
}

// transferOne performs a single TransferFactory_Transfer + auto-accept.
func (r *Runner) transferOne(ctx context.Context, rc *registry.Client, ev *store.EventRow, opParty string, it StakedItem, amount string) (PayoutEntry, error) {
	// meta stamp: showorsow.dev/event = eventId "/" slotId (05 §5 / 06 E13).
	metaVal := ev.EventID + "/" + it.SlotID

	// TransferFactory_Transfer choice-argument record. The registry re-derives
	// input holdings; we supply sender/receiver/amount/instrument + meta.
	transferArg := map[string]any{
		"transfer": map[string]any{
			"sender":   opParty,
			"receiver": it.AttendeeParty,
			"amount":   amount,
			"instrumentId": map[string]any{
				"admin": ev.InstrumentAdmin,
				"id":    ev.InstrumentID,
			},
			"meta": map[string]any{
				"values": map[string]any{
					"showorsow.dev/event": metaVal,
				},
			},
		},
	}
	choiceArgs, _ := json.Marshal(transferArg)

	cc, err := rc.TransferFactory(ctx, ev.InstrumentAdmin, choiceArgs)
	if err != nil {
		return PayoutEntry{}, fmt.Errorf("transfer-factory: %w", err)
	}
	if cc.FactoryID == "" {
		return PayoutEntry{}, fmt.Errorf("transfer-factory returned no factoryId")
	}

	// Exercise TransferFactory_Transfer as appOperator (pot owner). extraArgs
	// carries the registry context + disclosedContracts.
	extra := cc.ExtraArgs
	if len(extra) == 0 {
		extra = wrapExtraArgs(cc.ChoiceContextData)
	}
	exArg, _ := json.Marshal(map[string]any{
		"expectedAdmin": ev.InstrumentAdmin,
		"transfer":      transferArg["transfer"],
		"extraArgs":     json.RawMessage(extra),
	})
	// templateId names the TransferFactory INTERFACE; the contract id is the
	// factory cid the registry returned (F2).
	cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
		TemplateID:     ledger.TransferFactoryInterfaceID,
		ContractID:     cc.FactoryID,
		Choice:         "TransferFactory_Transfer",
		ChoiceArgument: exArg,
	}}
	resp, err := r.d.Ledger.SubmitAndWait(ctx, opParty, r.cmdID("payout"), []ledger.Command{cmd}, cc.DisclosedContracts)
	if err != nil {
		return PayoutEntry{}, fmt.Errorf("exercise TransferFactory_Transfer: %w", err)
	}

	// The transfer produces a TransferInstruction (two-step) — pull its cid.
	transferCid, _ := resp.CreatedByInterface("Splice.Api.Token.TransferInstructionV1:TransferInstruction")
	if transferCid == "" {
		// One-step transfer (auto-completed) — no instruction to accept.
		return PayoutEntry{RecipientParty: r.labelFor(ctx, it.AttendeeParty), Amount: amount, TransferCid: ""}, nil
	}

	// Two-step: auto-TransferInstruction_Accept as the recipient user party.
	if err := r.acceptTransfer(ctx, rc, ev, it.AttendeeParty, transferCid); err != nil {
		r.logErr("payout-accept", err)
		// The offer exists even if accept failed; the recipient can retry.
	}

	return PayoutEntry{RecipientParty: r.labelFor(ctx, it.AttendeeParty), Amount: amount, TransferCid: transferCid}, nil
}

// acceptTransfer auto-accepts a pending payout TransferInstruction as the
// recipient user party (05 §5.3).
func (r *Runner) acceptTransfer(ctx context.Context, rc *registry.Client, ev *store.EventRow, recipientParty, instructionCid string) error {
	cc, err := rc.TransferInstructionChoiceContext(ctx, instructionCid, "accept")
	if err != nil {
		return fmt.Errorf("accept choice-context: %w", err)
	}
	extra := cc.ExtraArgs
	if len(extra) == 0 {
		extra = wrapExtraArgs(cc.ChoiceContextData)
	}
	exArg, _ := json.Marshal(map[string]any{"extraArgs": json.RawMessage(extra)})
	cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
		TemplateID:     "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction",
		ContractID:     instructionCid,
		Choice:         "TransferInstruction_Accept",
		ChoiceArgument: exArg,
	}}
	_, err = r.d.Ledger.SubmitAndWait(ctx, recipientParty, r.cmdID("payout-accept"), []ledger.Command{cmd}, cc.DisclosedContracts)
	return err
}

// ---- decimal math (floor division, 05 §5) ----

// floorDiv computes floor(total / n) at the given number of decimals.
func floorDiv(total *big.Rat, n int64, decimals int) *big.Rat {
	if n == 0 {
		return new(big.Rat)
	}
	q := new(big.Rat).Quo(total, big.NewRat(n, 1))
	return floorRat(q, decimals)
}

// floorRat truncates a rational toward zero at `decimals` places.
func floorRat(x *big.Rat, decimals int) *big.Rat {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(decimals)), nil)
	scaled := new(big.Rat).Mul(x, new(big.Rat).SetInt(scale))
	// floor of scaled numerator/denominator.
	fl := new(big.Int).Quo(scaled.Num(), scaled.Denom()) // Quo truncates toward zero; amounts are non-negative here
	res := new(big.Rat).SetFrac(fl, scale)
	return res
}

// ratToDecimalString renders a rational as a fixed-scale decimal string.
func ratToDecimalString(x *big.Rat, decimals int) string {
	return x.FloatString(decimals)
}
