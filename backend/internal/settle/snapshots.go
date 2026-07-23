package settle

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/store"
)

// IsLocked reports whether a Holding interface view's `lock` field is present
// and non-null (i.e. the Holding is locked and therefore not spendable). Locked
// Holdings are excluded from spendable balances and allocation inputs (F10);
// settlement snapshots deliberately use the TOTAL basis instead — see snapshot.
func IsLocked(lock json.RawMessage) bool {
	t := bytes.TrimSpace(lock)
	return len(t) > 0 && !bytes.Equal(t, []byte("null"))
}

// snapshot writes balance_snapshots for the given parties at a phase (05 §6).
// appOperator cannot see attendee Holdings (Canton visibility), so each party's
// Holdings are queried with THAT party's own JWT (the ledger client selects the
// token by the acting party).
//
// Snapshots use the TOTAL basis (locked Holdings included): the before-snapshot
// is taken while stakes sit locked in Allocations, so on the spendable basis a
// slashed ghost's delta would read ~0 and a refunded attendee's +stake+share.
// Total basis yields the demo-correct deltas: ghost -stake, refunded +share.
func (r *Runner) snapshot(ctx context.Context, ev *store.EventRow, parties []string, phase store.SnapshotPhase) error {
	for _, party := range parties {
		amount, err := r.holdingSumTotal(ctx, party, ev.InstrumentAdmin, ev.InstrumentID)
		if err != nil {
			r.logErr("snapshot-holding-sum", err)
			continue
		}
		if err := r.d.Store.WriteBalanceSnapshot(ctx, store.BalanceSnapshot{
			EventID:      ev.EventID,
			Party:        party,
			Phase:        phase,
			InstrumentID: ev.InstrumentID,
			Amount:       amount,
		}); err != nil {
			r.logErr("snapshot-write", err)
		}
	}
	return nil
}

// holdingSumTotal sums the party's live Holding amounts for (admin,
// instrumentId) on the TOTAL basis (locked included) — snapshots only.
func (r *Runner) holdingSumTotal(ctx context.Context, party, admin, instrumentID string) (string, error) {
	amounts, err := holdingAmountsWhere(ctx, r.d.Ledger, party, admin, instrumentID, true)
	if err != nil {
		return "0", err
	}
	return sumDecimalStrings(amounts), nil
}

// HoldingSum is the shared SPENDABLE-basis balance query (locked excluded),
// exported so the API /api/balances handler reuses the exact same path
// (04 §2 balances row).
func HoldingSum(ctx context.Context, lc *ledger.Client, party, admin, instrumentID string) (string, error) {
	amounts, err := HoldingAmounts(ctx, lc, party, admin, instrumentID)
	if err != nil {
		return "0", err
	}
	sum := sumDecimalStrings(amounts)
	return sum, nil
}

// holdingViewValue is the decoded Holding interface view (CIP-56).
type holdingViewValue struct {
	Owner        string `json:"owner"`
	InstrumentID struct {
		Admin string `json:"admin"`
		ID    string `json:"id"`
	} `json:"instrumentId"`
	Amount string          `json:"amount"`
	Lock   json.RawMessage `json:"lock"`
}

// HoldingAmounts returns the SPENDABLE Holding amounts matching (owner, admin,
// instrumentId) — locked Holdings excluded (F10: pre-check + /api/balances).
func HoldingAmounts(ctx context.Context, lc *ledger.Client, party, admin, instrumentID string) ([]string, error) {
	return holdingAmountsWhere(ctx, lc, party, admin, instrumentID, false)
}

// HoldingCids returns the SPENDABLE Holding contract ids matching (owner,
// admin, instrumentId). The real registry requires inputHoldingCids on
// TransferFactory_Transfer / AllocationFactory_Allocate (verified live on
// DevNet — it does not re-derive them server-side).
func HoldingCids(ctx context.Context, lc *ledger.Client, party, admin, instrumentID string) ([]string, error) {
	acs, err := lc.ActiveContracts(ctx, party, []ledger.CumulativeFilter{{
		InterfaceFilter: &ledger.InterfaceFilter{
			InterfaceID:          ledger.HoldingInterfaceID,
			IncludeInterfaceView: true,
		},
	}})
	if err != nil {
		return nil, err
	}
	var out []string
	for _, ac := range acs {
		raw, ok := ac.InterfaceViewValue("Splice.Api.Token.HoldingV1:Holding")
		if !ok {
			continue
		}
		var v holdingViewValue
		if err := json.Unmarshal(raw, &v); err != nil {
			continue
		}
		if v.Owner != party || v.InstrumentID.Admin != admin || v.InstrumentID.ID != instrumentID {
			continue
		}
		if IsLocked(v.Lock) {
			continue
		}
		out = append(out, ac.CreatedEvent.ContractID)
	}
	return out, nil
}

// holdingAmountsWhere is the shared Holding query; includeLocked selects the
// TOTAL basis (snapshots) vs the SPENDABLE basis (everything else).
func holdingAmountsWhere(ctx context.Context, lc *ledger.Client, party, admin, instrumentID string, includeLocked bool) ([]string, error) {
	acs, err := lc.ActiveContracts(ctx, party, []ledger.CumulativeFilter{{
		InterfaceFilter: &ledger.InterfaceFilter{
			InterfaceID:          ledger.HoldingInterfaceID,
			IncludeInterfaceView: true,
		},
	}})
	if err != nil {
		return nil, err
	}
	var out []string
	for _, ac := range acs {
		raw, ok := ac.InterfaceViewValue("Splice.Api.Token.HoldingV1:Holding")
		if !ok {
			continue
		}
		var v holdingViewValue
		if err := json.Unmarshal(raw, &v); err != nil {
			continue
		}
		// client-side filter: owner + instrument (JSON API v2 can't do it, 03 §1).
		if v.Owner != party {
			continue
		}
		if v.InstrumentID.Admin != admin || v.InstrumentID.ID != instrumentID {
			continue
		}
		// Spendable basis excludes locked Holdings — the §3.1 pre-check must
		// reflect spendable balance, else a locked stake passes the check and
		// fails allocate (F10). Snapshots pass includeLocked=true (total basis).
		if !includeLocked && IsLocked(v.Lock) {
			continue
		}
		out = append(out, v.Amount)
	}
	return out, nil
}
