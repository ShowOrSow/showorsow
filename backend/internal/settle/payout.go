package settle

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"time"

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

	// Demo token (SHOW) has no registry: decimals are the Daml Decimal scale and
	// the payout path is issuer-side (archive pot + mint shares) — see
	// runDemoPayouts. Found by the live E2E sweep: the registry-based path
	// silently skipped payouts for demo events (payouts:null), so the demo never
	// showed "ghosts fund the people who came".
	demo := r.d.Cfg.IsDemoToken(ev.InstrumentAdmin, ev.InstrumentID)

	// Fetch registry decimals only now, AFTER the zero-guards: settlement
	// (refund/slash) never needs decimals, so a registry-metadata outage must
	// degrade payouts alone, not abort the whole settlement (F12).
	decimals := 10 // Daml Decimal scale — the demo token's native precision
	if !demo {
		var err error
		decimals, err = r.decimalsFor(ctx, ev)
		if err != nil {
			r.logErr("payout-decimals", err)
			return nil, nil
		}
	}

	share := floorDiv(slashedTotal, int64(checkedInCount), decimals)
	if share.Sign() == 0 {
		// Every share floors to zero — dust stays in pot, no payouts.
		return nil, nil
	}
	shareStr := ratToDecimalString(share, decimals)

	if demo {
		entries, err := r.runDemoPayouts(ctx, ev, opParty, checkedIn, share, decimals)
		if err != nil {
			r.logErr("payout-demo", err)
			return nil, nil
		}
		return entries, nil
	}

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

// runDemoPayouts redistributes the demo-token pot without a registry. The demo
// token's DemoHolding has a SINGLE signatory — the issuer (appOperator) — so the
// pot owner can do the whole redistribution alone, atomically, in one command:
// archive pot holdings covering the payout total, Mint each recipient's share,
// and Mint any change back to the pot. Supply-neutral by construction
// (archived == minted).
func (r *Runner) runDemoPayouts(ctx context.Context, ev *store.EventRow, opParty string, checkedIn []StakedItem, share *big.Rat, decimals int) ([]PayoutEntry, error) {
	acs, err := r.d.Ledger.ActiveContracts(ctx, opParty, []ledger.CumulativeFilter{{
		WildcardFilter: &ledger.WildcardFilter{IncludeCreatedEventBlob: false},
	}})
	if err != nil {
		return nil, fmt.Errorf("demo-payout acs: %w", err)
	}

	// Discover the DemoIssuer (entity-name match — the demo DAR's package id is
	// never configured, 05 §6c) and the pot's unlocked demo holdings.
	var issuerCid, issuerTpl string
	type potHolding struct {
		cid, tpl string
		amount   *big.Rat
	}
	var pot []potHolding
	for _, ac := range acs {
		tpl := ac.CreatedEvent.TemplateID
		if ledger.MatchesEntity(tpl, ledger.EntityDemoIssuer) && issuerCid == "" {
			issuerCid, issuerTpl = ac.CreatedEvent.ContractID, tpl
			continue
		}
		raw, ok := ac.InterfaceViewValue("Splice.Api.Token.HoldingV1:Holding")
		if !ok {
			continue
		}
		var v holdingViewValue
		if err := json.Unmarshal(raw, &v); err != nil {
			continue
		}
		if v.Owner != opParty || v.InstrumentID.Admin != ev.InstrumentAdmin ||
			v.InstrumentID.ID != ev.InstrumentID || IsLocked(v.Lock) {
			continue
		}
		amt, okAmt := new(big.Rat).SetString(v.Amount)
		if !okAmt {
			continue
		}
		pot = append(pot, potHolding{cid: ac.CreatedEvent.ContractID, tpl: tpl, amount: amt})
	}
	if issuerCid == "" {
		return nil, fmt.Errorf("demo-payout: no DemoIssuer visible to %s", opParty)
	}

	// Greedy-pick pot holdings until they cover the payout total.
	needed := new(big.Rat).Mul(share, big.NewRat(int64(len(checkedIn)), 1))
	picked := new(big.Rat)
	var cmds []ledger.Command
	for _, h := range pot {
		if picked.Cmp(needed) >= 0 {
			break
		}
		picked.Add(picked, h.amount)
		cmds = append(cmds, ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     h.tpl,
			ContractID:     h.cid,
			Choice:         "Archive",
			ChoiceArgument: json.RawMessage(`{}`),
		}})
	}
	if picked.Cmp(needed) < 0 {
		return nil, fmt.Errorf("demo-payout: pot %s short of payout total %s",
			ratToDecimalString(picked, decimals), ratToDecimalString(needed, decimals))
	}

	shareStr := ratToDecimalString(share, decimals)
	mint := func(recipient, amount string) {
		arg, _ := json.Marshal(map[string]any{"recipient": recipient, "amount": amount})
		cmds = append(cmds, ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     issuerTpl,
			ContractID:     issuerCid,
			Choice:         "Mint",
			ChoiceArgument: arg,
		}})
	}
	for _, it := range checkedIn {
		mint(it.AttendeeParty, shareStr)
	}
	if change := new(big.Rat).Sub(picked, needed); change.Sign() > 0 {
		mint(opParty, ratToDecimalString(change, decimals))
	}

	if _, err := r.d.Ledger.SubmitAndWait(ctx, opParty, r.cmdID("payout-demo"), cmds, nil); err != nil {
		return nil, fmt.Errorf("demo-payout submit: %w", err)
	}
	var out []PayoutEntry
	for _, it := range checkedIn {
		out = append(out, PayoutEntry{
			RecipientParty: r.labelFor(ctx, it.AttendeeParty),
			Amount:         shareStr,
		})
	}
	return out, nil
}

// transferOne performs a single TransferFactory_Transfer + auto-accept.
func (r *Runner) transferOne(ctx context.Context, rc *registry.Client, ev *store.EventRow, opParty string, it StakedItem, amount string) (PayoutEntry, error) {
	// meta stamp: showorsow.dev/event = eventId "/" slotId (05 §5 / 06 E13).
	metaVal := ev.EventID + "/" + it.SlotID

	// TransferFactory_Transfer choice-argument record. The real registry does
	// NOT re-derive input holdings — the Transfer record requires requestedAt,
	// executeBefore and inputHoldingCids, and discovery must receive the FULL
	// record (verified live on DevNet: bare {transfer} → decoding_error).
	potHoldings, err := HoldingCids(ctx, r.d.Ledger, opParty, ev.InstrumentAdmin, ev.InstrumentID)
	if err != nil {
		return PayoutEntry{}, fmt.Errorf("gather pot holdings: %w", err)
	}
	transfer := map[string]any{
		"sender":   opParty,
		"receiver": it.AttendeeParty,
		"amount":   amount,
		"instrumentId": map[string]any{
			"admin": ev.InstrumentAdmin,
			"id":    ev.InstrumentID,
		},
		"requestedAt":      time.Now().UTC().Format(time.RFC3339Nano),
		"executeBefore":    ev.SettleBefore.UTC().Format(time.RFC3339Nano),
		"inputHoldingCids": potHoldings,
		"meta": map[string]any{
			"values": map[string]any{
				"showorsow.dev/event": metaVal,
			},
		},
	}
	transferArg := map[string]any{"transfer": transfer}
	choiceArgs, _ := json.Marshal(map[string]any{
		"expectedAdmin": ev.InstrumentAdmin,
		"transfer":      transfer,
		"extraArgs":     json.RawMessage(registry.EmptyExtraArgs()),
	})

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
	return AcceptTransferInstruction(ctx, r.d.Ledger, rc, recipientParty, instructionCid, r.cmdID("payout-accept"))
}

// AcceptTransferInstruction fetches the accept ChoiceContext for a pending
// TransferInstruction and exercises TransferInstruction_Accept as the receiving
// party. This is the single accept code path shared by the payout runner
// (05 §5.3) and the deposit acceptor (05 §6b) — same registry choice-context +
// exercise, different callers/scope.
func AcceptTransferInstruction(ctx context.Context, lc *ledger.Client, rc *registry.Client, receiverParty, instructionCid, commandID string) error {
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
		TemplateID:     ledger.TransferInstructionInterfaceID,
		ContractID:     instructionCid,
		Choice:         "TransferInstruction_Accept",
		ChoiceArgument: exArg,
	}}
	_, err = lc.SubmitAndWait(ctx, receiverParty, commandID, []ledger.Command{cmd}, cc.DisclosedContracts)
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
