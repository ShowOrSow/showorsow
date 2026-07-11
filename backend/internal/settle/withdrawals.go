package settle

import (
	"context"
	"encoding/json"
	"time"

	"github.com/showorsow/backend/internal/ledger"
)

// Watcher is the withdrawal watcher (05 §7). Every 10s it selects staked RSVPs
// flagged withdrawal_detected and exercises MarkWithdrawn as appOperator.
// Idempotent: E9 flips status='withdrawn', dropping the row from the query.
type Watcher struct {
	d    Deps
	tick time.Duration
}

// NewWatcher builds a withdrawal Watcher with the spec's 10s tick.
func NewWatcher(d Deps) *Watcher {
	return &Watcher{d: d, tick: 10 * time.Second}
}

// Run drives the watcher until ctx is cancelled. Intended to run in its own
// goroutine.
func (w *Watcher) Run(ctx context.Context) {
	t := time.NewTicker(w.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.sweep(ctx)
		}
	}
}

// sweep runs one pass. Errors are logged, never fatal — the next tick retries.
func (w *Watcher) sweep(ctx context.Context) {
	opParty, ok := w.d.Personas.Party(w.d.Cfg.AppOperatorPersona)
	if !ok {
		return
	}
	cands, err := w.d.Store.ListWithdrawalCandidates(ctx)
	if err != nil {
		w.logErr("withdrawal-query", err)
		return
	}
	for _, c := range cands {
		if c.RSVPCID == "" {
			continue
		}
		cmd := ledger.Command{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     w.d.Pkg.TemplateID(ledger.TplStakedRSVP),
			ContractID:     c.RSVPCID,
			Choice:         "MarkWithdrawn",
			ChoiceArgument: json.RawMessage(`{}`),
		}}
		if _, err := w.d.Ledger.SubmitAndWait(ctx, opParty, w.cmdID("watcher-markwithdrawn"), []ledger.Command{cmd}, nil); err != nil {
			// A concurrent settle may already have consumed the RSVP; log and
			// move on. The row drops out once the indexer projects E9.
			w.logErr("withdrawal-markwithdrawn", err)
		}
	}
}

func (w *Watcher) cmdID(prefix string) string {
	if w.d.NewIDFunc != nil {
		return prefix + "-" + w.d.NewIDFunc()
	}
	return prefix
}

func (w *Watcher) logErr(stage string, err error) {
	if w.d.Errorf != nil {
		w.d.Errorf(w.cmdID("err"), stage, err)
	}
}
