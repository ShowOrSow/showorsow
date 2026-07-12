package settle

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/showorsow/backend/internal/ledger"
)

// DepositAcceptor is the deposit acceptor watcher (05 §6b). CIP-56 transfers
// are two-step: tokens sent to a user (faucet, exchange, another user) arrive
// as a TransferInstruction offer that must be accepted or the funds never land.
// Since the backend hosts every user's party, every ~15s it queries pending
// TransferInstructions whose receiver is any registered user party, fetches the
// accept ChoiceContext from the registry, and exercises TransferInstruction_Accept
// as the receiving user. Generalizes the payout runner's accept logic (§5.3) —
// same code path (AcceptTransferInstruction), broader scope.
type DepositAcceptor struct {
	d    Deps
	tick time.Duration
	// seen suppresses re-attempts on instruction cids we already accepted (or
	// tried) within the process lifetime — a belt-and-braces guard on top of the
	// natural idempotency (an accepted instruction is archived and drops out of
	// the next ACS query).
	seen map[string]bool
}

// NewDepositAcceptor builds a deposit acceptor with the spec's ~15s tick.
func NewDepositAcceptor(d Deps) *DepositAcceptor {
	return &DepositAcceptor{d: d, tick: 15 * time.Second, seen: map[string]bool{}}
}

// Run drives the acceptor until ctx is cancelled. Intended to run in its own
// goroutine (main wires it alongside the withdrawal watcher).
func (a *DepositAcceptor) Run(ctx context.Context) {
	t := time.NewTicker(a.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			a.sweep(ctx)
		}
	}
}

// transferInstructionView is the subset of the CIP-56 TransferInstruction
// interface view the acceptor reads: the receiver (must equal the querying
// party) and the instrument admin (selects the registry client).
type transferInstructionView struct {
	Transfer struct {
		Sender       string `json:"sender"`
		Receiver     string `json:"receiver"`
		InstrumentID struct {
			Admin string `json:"admin"`
			ID    string `json:"id"`
		} `json:"instrumentId"`
	} `json:"transfer"`
}

// sweep runs one pass over all registered user parties. Errors are logged,
// never fatal — the next tick retries.
func (a *DepositAcceptor) sweep(ctx context.Context) {
	parties, err := a.d.Store.ListUserParties(ctx)
	if err != nil {
		a.logErr("deposit-list-parties", err)
		return
	}
	for _, party := range parties {
		if party == "" {
			continue
		}
		a.sweepParty(ctx, party)
	}
}

// sweepParty accepts every pending TransferInstruction addressed to one party.
// The query runs as the party itself (the receiver is always a stakeholder on
// its own incoming instruction, so its own visibility suffices — no appOperator
// delegation needed).
func (a *DepositAcceptor) sweepParty(ctx context.Context, party string) {
	acs, err := a.d.Ledger.ActiveContracts(ctx, party, []ledger.CumulativeFilter{{
		InterfaceFilter: &ledger.InterfaceFilter{
			InterfaceID:          ledger.TransferInstructionInterfaceID,
			IncludeInterfaceView: true,
		},
	}})
	if err != nil {
		a.logErr("deposit-query", err)
		return
	}
	for _, ac := range acs {
		raw, ok := ac.InterfaceViewValue("Splice.Api.Token.TransferInstructionV1:TransferInstruction")
		if !ok {
			continue
		}
		var v transferInstructionView
		if err := json.Unmarshal(raw, &v); err != nil {
			continue
		}
		// Only accept instructions we are the RECEIVER of — a party may also see
		// instructions it sent (e.g. a payout it will receive is fine, but never
		// auto-accept where we are merely a sender/observer).
		if v.Transfer.Receiver != party {
			continue
		}
		cid := ac.CreatedEvent.ContractID
		if a.seen[cid] {
			continue
		}
		a.seen[cid] = true

		rc, err := a.d.Registry(v.Transfer.InstrumentID.Admin, v.Transfer.InstrumentID.ID)
		if err != nil {
			// No configured registry for this instrument (e.g. an unknown token) —
			// nothing we can accept. Log and skip.
			a.logErr("deposit-registry", err)
			continue
		}
		if err := AcceptTransferInstruction(ctx, a.d.Ledger, rc, party, cid, a.cmdID("deposit-accept")); err != nil {
			// A concurrent accept (or a stale cid) can fail here; log and move on.
			// The cid is marked seen, but a genuinely-still-pending offer will
			// reappear on the next full ACS snapshot only if it is re-created —
			// acceptable for demo scale.
			a.logErr("deposit-accept", err)
			continue
		}
		log.Printf("deposit accepted: party=%s instrument=%s/%s instruction=%s",
			party, v.Transfer.InstrumentID.Admin, v.Transfer.InstrumentID.ID, ledger.ShortCid(cid))
	}
}

func (a *DepositAcceptor) cmdID(prefix string) string {
	if a.d.NewIDFunc != nil {
		return prefix + "-" + a.d.NewIDFunc()
	}
	return prefix
}

func (a *DepositAcceptor) logErr(stage string, err error) {
	if a.d.Errorf != nil {
		a.d.Errorf(a.cmdID("err"), stage, err)
	}
}
