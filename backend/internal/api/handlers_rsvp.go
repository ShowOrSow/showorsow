package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/settle"
	"github.com/showorsow/backend/internal/store"
	"github.com/showorsow/backend/internal/users"
)

// POST /api/events/{eventId}/invites — {email} → refreshed rsvp row.
// Organizer-only (403 otherwise). The invitee must already have an account —
// a party must exist to be invited (MVP), so an unknown email → 404
// {stage:'user'}. Ledger: Event.InviteAttendee (04 §1.2).
func (s *Server) handleInvite(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("eventId")
	_, ev, ok := s.requireOrganizer(w, r, eventID)
	if !ok {
		return
	}
	organizerParty := ev.OrganizerParty

	var req struct {
		Email string `json:"email"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	invitee, err := s.users.GetByEmail(ctx(r), req.Email)
	if errors.Is(err, users.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, errBody{
			Error:  "no account",
			Stage:  "user",
			Detail: "no account with that email — ask them to sign up",
		})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	attendeeParty := invitee.PartyID
	// slotId identifies the RSVP slot on-ledger; the invitee's email is a stable
	// unique key per event.
	slotID := invitee.Email

	arg, _ := json.Marshal(map[string]any{"attendee": attendeeParty, "slotId": slotID})
	_, err = s.ledger.SubmitAndWait(ctx(r), organizerParty, "invite-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplEvent),
			ContractID:     ev.ContractID,
			Choice:         "InviteAttendee",
			ChoiceArgument: arg,
		}}}, nil)
	if err != nil {
		writeErr502(w, "invite-attendee", "", err)
		return
	}
	s.respondRSVP(w, r, eventID, attendeeParty)
}

// POST /api/invites/{inviteCid}/accept — runs the stake flow §3.
//
//	→ refreshed rsvp row
//	| 409 {stage:'balance'}                       (pre-check fails)
//	| 502 {stage:'allocate', errorId, rsvpCid}    (steps 3–5 fail)
func (s *Server) handleAccept(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	attendeeParty := u.PartyID
	inviteCid := r.PathValue("inviteCid")

	// Resolve the invite → event + slot (read model).
	rv, err := s.store.GetRSVPByInviteCid(ctx(r), inviteCid)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "invite not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// F7: only the invited attendee may accept their own invite. Without this an
	// attacker could stake the CALLER's funds against another RSVP's
	// settlementRef and strand them in an unrecorded Allocation.
	if rv.AttendeeParty != attendeeParty {
		writeErr(w, http.StatusForbidden, "not your invite")
		return
	}
	ev, err := s.store.GetEvent(ctx(r), rv.EventID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// §3.1 Pre-check: query attendee Holdings; if sum < stake → 409
	// {stage:'balance'} WITHOUT touching the ledger.
	if !s.hasSufficientBalance(ctx(r), attendeeParty, ev) {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "insufficient balance", "stage": "balance"})
		return
	}

	// §3.2 AcceptRSVP(currentEventCid) as attendee → StakedRSVP cid.
	arg, _ := json.Marshal(map[string]any{"currentEventCid": ev.ContractID})
	acceptResp, err := s.ledger.SubmitAndWait(ctx(r), attendeeParty, "accept-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplRSVPInvite),
			ContractID:     inviteCid,
			Choice:         "AcceptRSVP",
			ChoiceArgument: arg,
		}}}, nil)
	if err != nil {
		writeErr502(w, "accept-rsvp", "", err)
		return
	}
	stakedCid, ok := acceptResp.CreatedByTemplate(ledger.TplStakedRSVP)
	if !ok {
		writeErr502(w, "accept-rsvp", "", errors.New("no StakedRSVP created"))
		return
	}

	// §3.3–3.5 allocation. On failure the RSVP stays 'accepted'; frontend shows
	// Retry stake → POST /api/rsvps/{rsvpCid}/stake.
	if err := s.runAllocation(ctx(r), ev, rv.SlotID, attendeeParty, stakedCid); err != nil {
		writeJSON(w, http.StatusBadGateway, errBody{
			Error:   "allocation failed",
			Stage:   "allocate",
			Detail:  err.Error(),
			ErrorID: logAndID("allocate", err),
			RSVPCid: stakedCid,
		})
		return
	}
	s.respondRSVP(w, r, rv.EventID, attendeeParty)
}

// POST /api/rsvps/{rsvpCid}/stake — retry endpoint: re-runs §3 steps 3–6 for an
// RSVP stuck in 'accepted' (partial-failure recovery).
func (s *Server) handleStake(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	attendeeParty := u.PartyID
	rsvpCid := r.PathValue("rsvpCid")

	rv, err := s.store.GetRSVPByCid(ctx(r), rsvpCid)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "rsvp not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// F7: only the RSVP's own attendee may (re)stake it.
	if rv.AttendeeParty != attendeeParty {
		writeErr(w, http.StatusForbidden, "not your rsvp")
		return
	}
	ev, err := s.store.GetEvent(ctx(r), rv.EventID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	if err := s.runAllocation(ctx(r), ev, rv.SlotID, attendeeParty, rsvpCid); err != nil {
		writeJSON(w, http.StatusBadGateway, errBody{
			Error:   "allocation failed",
			Stage:   "allocate",
			Detail:  err.Error(),
			ErrorID: logAndID("allocate-retry", err),
			RSVPCid: rsvpCid,
		})
		return
	}
	s.respondRSVP(w, r, rv.EventID, attendeeParty)
}

// runAllocation performs §3 steps 3–5: registry discovery + Allocate as
// attendee + RecordAllocation as appOperator.
func (s *Server) runAllocation(ctx context.Context, ev *store.EventRow, slotID, attendeeParty, stakedCid string) error {
	rc, err := s.registryFor(ev.InstrumentAdmin, ev.InstrumentID)
	if err != nil {
		return fmt.Errorf("registry client: %w", err)
	}

	// §3.3 AllocationFactoryDiscovery + Allocate ChoiceContext. The allocation
	// spec is derived from the StakedRSVP's AllocationRequest view: single leg
	// (attendee → pot, stakeAmount, instrument), settlementRef eventId/slotId.
	appOperatorParty := s.cfg.AppOperatorParty
	settlementRefID := ev.EventID + "/" + slotID
	requestedAt := time.Now().UTC().Format(time.RFC3339Nano)

	allocSpec := map[string]any{
		"settlement": map[string]any{
			"executor":       appOperatorParty,
			"settlementRef":  map[string]any{"id": settlementRefID, "cid": nil},
			"requestedAt":    requestedAt,
			"allocateBefore": ev.RSVPDeadline.UTC().Format(time.RFC3339Nano),
			"settleBefore":   ev.SettleBefore.UTC().Format(time.RFC3339Nano),
			"meta":           map[string]any{"values": map[string]any{}},
		},
		"transferLegId": slotID,
		"transferLeg": map[string]any{
			"sender":       attendeeParty,
			"receiver":     appOperatorParty,
			"amount":       ev.StakeAmount,
			"instrumentId": map[string]any{"admin": ev.InstrumentAdmin, "id": ev.InstrumentID},
			"meta":         map[string]any{"values": map[string]any{}},
		},
	}
	choiceArgs, _ := json.Marshal(map[string]any{"allocation": allocSpec})

	cc, err := rc.AllocationFactoryDiscovery(ctx, choiceArgs)
	if err != nil {
		return fmt.Errorf("allocation-factory discovery: %w", err)
	}
	if cc.FactoryID == "" {
		return fmt.Errorf("allocation-factory returned no factoryId")
	}

	// §3.4 AllocationFactory_Allocate as attendee, with input Holding cids +
	// disclosedContracts + extraArgs. A bare exercise WILL fail — we gather the
	// attendee's Holding cids and let the registry consolidate. If no single
	// combination fits, UTXO consolidation would run first (documented TODO).
	holdingCids, err := s.holdingCids(ctx, attendeeParty, ev.InstrumentAdmin, ev.InstrumentID)
	if err != nil {
		return fmt.Errorf("gather holdings: %w", err)
	}
	extra := cc.ExtraArgs
	if len(extra) == 0 {
		extra = wrapExtra(cc.ChoiceContextData)
	}
	allocateArg, _ := json.Marshal(map[string]any{
		"expectedAdmin":    ev.InstrumentAdmin,
		"allocation":       allocSpec,
		"requestedAt":      requestedAt,
		"inputHoldingCids": holdingCids,
		"extraArgs":        json.RawMessage(extra),
	})
	// templateId names the AllocationFactory INTERFACE; the contract id is the
	// factory cid the registry returned (F2 — a contract id can never resolve as
	// a templateId).
	allocResp, err := s.ledger.SubmitAndWait(ctx, attendeeParty, "allocate-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     ledger.AllocationFactoryInterfaceID,
			ContractID:     cc.FactoryID,
			Choice:         "AllocationFactory_Allocate",
			ChoiceArgument: allocateArg,
		}}}, cc.DisclosedContracts)
	if err != nil {
		return fmt.Errorf("AllocationFactory_Allocate: %w", err)
	}

	// §3.5 Poll the AllocationInstruction result → on Completed the Allocation
	// exists. Pull the Allocation cid from the interface view in the result.
	allocCid, ok := allocResp.CreatedByInterface("Splice.Api.Token.AllocationV1:Allocation")
	if !ok {
		// Two-step allocation instruction — poll active-contracts for the
		// resulting Allocation matching our settlementRef.
		allocCid, err = s.pollAllocation(ctx, appOperatorParty, settlementRefID)
		if err != nil {
			return fmt.Errorf("await allocation completion: %w", err)
		}
	}

	// RecordAllocation(allocCid) as appOperator — the choice re-validates that
	// the allocation matches this RSVP (04 §1.4).
	recArg, _ := json.Marshal(map[string]any{"allocCid": allocCid})
	_, err = s.ledger.SubmitAndWait(ctx, appOperatorParty, "record-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplStakedRSVP),
			ContractID:     stakedCid,
			Choice:         "RecordAllocation",
			ChoiceArgument: recArg,
		}}}, nil)
	if err != nil {
		return fmt.Errorf("RecordAllocation: %w", err)
	}
	return nil
}

// pollAllocation polls appOperator's active Allocations for one whose
// settlementRef.id matches, up to a short deadline (§3.5 "poll → Completed").
func (s *Server) pollAllocation(ctx context.Context, opParty, settlementRefID string) (string, error) {
	deadline := time.Now().Add(15 * time.Second)
	for {
		acs, err := s.ledger.ActiveContracts(ctx, opParty, []ledger.CumulativeFilter{{
			InterfaceFilter: &ledger.InterfaceFilter{
				InterfaceID:          ledger.AllocationInterfaceID,
				IncludeInterfaceView: true,
			},
		}})
		if err == nil {
			for _, ac := range acs {
				raw, ok := ac.InterfaceViewValue("Splice.Api.Token.AllocationV1:Allocation")
				if !ok {
					continue
				}
				var v struct {
					Allocation struct {
						Settlement struct {
							SettlementRef struct {
								ID string `json:"id"`
							} `json:"settlementRef"`
						} `json:"settlement"`
					} `json:"allocation"`
				}
				if json.Unmarshal(raw, &v) == nil && v.Allocation.Settlement.SettlementRef.ID == settlementRefID {
					return ac.CreatedEvent.ContractID, nil
				}
			}
		}
		if time.Now().After(deadline) {
			return "", errors.New("allocation not found within deadline")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
}

// POST /api/invites/{inviteCid}/decline — DeclineRSVP (04 §1.3).
func (s *Server) handleDecline(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	attendeeParty := u.PartyID
	inviteCid := r.PathValue("inviteCid")
	rv, err := s.store.GetRSVPByInviteCid(ctx(r), inviteCid)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "invite not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// F7: only the invited attendee may decline their own invite.
	if rv.AttendeeParty != attendeeParty {
		writeErr(w, http.StatusForbidden, "not your invite")
		return
	}
	_, err = s.ledger.SubmitAndWait(ctx(r), attendeeParty, "decline-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplRSVPInvite),
			ContractID:     inviteCid,
			Choice:         "DeclineRSVP",
			ChoiceArgument: json.RawMessage(`{}`),
		}}}, nil)
	if err != nil {
		writeErr502(w, "decline-rsvp", "", err)
		return
	}
	s.respondRSVP(w, r, rv.EventID, attendeeParty)
}

// POST /api/rsvps/{rsvpCid}/cancel — CancelRSVP (+ cancel ChoiceContext, 04 §1.4).
func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	attendeeParty := u.PartyID
	rsvpCid := r.PathValue("rsvpCid")
	rv, err := s.store.GetRSVPByCid(ctx(r), rsvpCid)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "rsvp not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// F7: only the RSVP's own attendee may cancel it.
	if rv.AttendeeParty != attendeeParty {
		writeErr(w, http.StatusForbidden, "not your rsvp")
		return
	}
	ev, err := s.store.GetEvent(ctx(r), rv.EventID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	// CancelRSVP takes an ExtraArgs (cancel ChoiceContext) when the RSVP is
	// allocated. Fetch it if we have an allocation cid.
	// Empty ChoiceContext is {"values":{}} — ExtraArgs.context is a ChoiceContext
	// record (TextMap), NOT Optional, so a null fails the Daml JSON decode (F9).
	var extra json.RawMessage = json.RawMessage(`{"context":{"values":{}},"meta":{"values":{}}}`)
	var disclosed []ledger.DisclosedContract
	if rv.AllocationCID != "" {
		rc, err := s.registryFor(ev.InstrumentAdmin, ev.InstrumentID)
		if err == nil {
			if cc, err := rc.AllocationChoiceContext(ctx(r), rv.AllocationCID, "cancel"); err == nil {
				if len(cc.ExtraArgs) > 0 {
					extra = cc.ExtraArgs
				} else {
					extra = wrapExtra(cc.ChoiceContextData)
				}
				disclosed = cc.DisclosedContracts
			}
		}
	}

	cancelArg, _ := json.Marshal(map[string]any{"extraArgs": extra})
	_, err = s.ledger.SubmitAndWait(ctx(r), attendeeParty, "cancel-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplStakedRSVP),
			ContractID:     rsvpCid,
			Choice:         "CancelRSVP",
			ChoiceArgument: cancelArg,
		}}}, disclosed)
	if err != nil {
		writeErr502(w, "cancel-rsvp", rsvpCid, err)
		return
	}
	s.respondRSVP(w, r, rv.EventID, attendeeParty)
}

// POST /api/events/{eventId}/checkin — {attendeeParty}. Organizer-only (403
// otherwise). One-way; a repeat call maps the 'not checkedIn' assert failure to
// a 200 no-op (05 §2).
func (s *Server) handleCheckin(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("eventId")
	// Organizer guard first (F1): without it any authenticated user could flip
	// an RSVP to checked-in and convert a slash into a refund + payout share.
	_, ev, ok := s.requireOrganizer(w, r, eventID)
	if !ok {
		return
	}

	var req struct {
		AttendeeParty string `json:"attendeeParty"`
	}
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}
	attendeeParty := req.AttendeeParty
	if attendeeParty == "" {
		writeErr(w, http.StatusBadRequest, "attendeeParty is required")
		return
	}

	rv, err := s.store.GetRSVP(ctx(r), eventID, attendeeParty)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "rsvp not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Already checked in → 200 no-op (matches the repeat-call contract).
	if rv.CheckedIn {
		s.respondRSVP(w, r, eventID, attendeeParty)
		return
	}

	orgParty := ev.OrganizerParty
	arg, _ := json.Marshal(map[string]any{"currentEventCid": ev.ContractID})
	_, err = s.ledger.SubmitAndWait(ctx(r), orgParty, "checkin-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplStakedRSVP),
			ContractID:     rv.RSVPCID,
			Choice:         "CheckIn",
			ChoiceArgument: arg,
		}}}, nil)
	if err != nil {
		// Map the 'not checkedIn' assert failure to a 200 no-op (double-click
		// safe, one-way check-in).
		if isAlreadyCheckedIn(err) {
			s.respondRSVP(w, r, eventID, attendeeParty)
			return
		}
		writeErr502(w, "checkin", rv.RSVPCID, err)
		return
	}
	s.respondRSVP(w, r, eventID, attendeeParty)
}

// POST /api/events/{eventId}/close — runs §4 → §5 → §6. Organizer-only.
func (s *Server) handleClose(w http.ResponseWriter, r *http.Request) {
	eventID := r.PathValue("eventId")
	_, ev, ok := s.requireOrganizer(w, r, eventID)
	if !ok {
		return
	}

	res, err := s.runner.Close(ctx(r), ev)
	if err != nil {
		writeErr502(w, "settlement", "", err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// GET /api/events/{eventId}/settlement — settlements ⋈ payouts ⋈ snapshots.
// User-scoped: the event's organizer sees ALL rows; an attendee sees ONLY their
// own settlement/payout/delta row (mirrors ledger visibility). Every
// `party`/`attendeeLabel` field is the owner's display NAME, never the party id.
func (s *Server) handleSettlement(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	party := u.PartyID
	eventID := r.PathValue("eventId")

	ev, err := s.store.GetEvent(ctx(r), eventID)
	if errors.Is(err, store.ErrNotFound) {
		writeErr(w, http.StatusNotFound, "event not found")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	isOrganizer := party == ev.OrganizerParty

	rows, err := s.store.GetSettlementPackage(ctx(r), eventID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	deltas, err := s.store.GetBalanceDeltas(ctx(r), eventID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	type settlementEntry struct {
		AttendeeLabel string `json:"attendeeLabel"`
		Outcome       string `json:"outcome"` // web-pinned: refunded | slashed
		Amount        string `json:"amount"`
		CheckedIn     bool   `json:"checkedIn"`
		IsGhost       bool   `json:"isGhost"`
		PayoutAmount  string `json:"payoutAmount,omitempty"`
		PayoutStatus  string `json:"payoutStatus,omitempty"`
		TxID          string `json:"txId,omitempty"`
	}
	type payoutEntry struct {
		Party  string `json:"party"`
		Amount string `json:"amount"`
	}
	type deltaEntry struct {
		Party  string `json:"party"`
		Before string `json:"before"`
		After  string `json:"after"`
	}
	out := struct {
		Settlements []settlementEntry `json:"settlements"`
		Payouts     []payoutEntry     `json:"payouts"`
		Deltas      []deltaEntry      `json:"deltas"`
	}{}
	// An attendee only sees the row for their own party.
	mine := func(rowParty string) bool { return isOrganizer || rowParty == party }
	for _, rrow := range rows {
		if !mine(rrow.AttendeeParty) {
			continue
		}
		label := s.labelForParty(ctx(r), rrow.AttendeeParty)
		entry := settlementEntry{
			AttendeeLabel: label,
			Outcome:       settle.WebOutcome(rrow.Outcome),
			Amount:        rrow.Amount,
			CheckedIn:     rrow.CheckedIn,
			IsGhost:       !rrow.CheckedIn,
			TxID:          rrow.UpdateID,
		}
		if rrow.PayoutAmount != "" && rrow.PayoutAmount != "0" {
			entry.PayoutAmount = rrow.PayoutAmount
			entry.PayoutStatus = rrow.PayoutStatus
			out.Payouts = append(out.Payouts, payoutEntry{Party: label, Amount: rrow.PayoutAmount})
		}
		out.Settlements = append(out.Settlements, entry)
	}
	for _, d := range deltas {
		label := s.labelForParty(ctx(r), d.Party)
		if !mine(d.Party) {
			continue
		}
		out.Deltas = append(out.Deltas, deltaEntry{Party: label, Before: d.Before, After: d.After})
	}
	writeJSON(w, http.StatusOK, out)
}

// ---- helpers ----

// respondRSVP re-reads and returns the current rsvps row for (event, attendee).
func (s *Server) respondRSVP(w http.ResponseWriter, r *http.Request, eventID, attendeeParty string) {
	rv, err := s.store.GetRSVP(ctx(r), eventID, attendeeParty)
	if errors.Is(err, store.ErrNotFound) {
		// The indexer may not have landed the projection yet; return a minimal
		// optimistic row so the UI can continue (eventual consistency, 07 §4).
		writeJSON(w, http.StatusOK, map[string]any{
			"eventId":       eventID,
			"attendeeParty": attendeeParty,
			"status":        "pending",
		})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"eventId":       rv.EventID,
		"attendeeParty": rv.AttendeeParty,
		"slotId":        rv.SlotID,
		"status":        rv.Status,
		"checkedIn":     rv.CheckedIn,
		"inviteCid":     rv.InviteCID,
		"rsvpCid":       rv.RSVPCID,
		"allocationCid": rv.AllocationCID,
	})
}

// hasSufficientBalance runs the §3.1 pre-check: attendee Holding sum ≥ stake.
func (s *Server) hasSufficientBalance(ctx context.Context, attendeeParty string, ev *store.EventRow) bool {
	amounts, err := settle.HoldingAmounts(ctx, s.ledger, attendeeParty, ev.InstrumentAdmin, ev.InstrumentID)
	if err != nil {
		// On query failure, fail the pre-check conservatively (return false) —
		// better a 409 than a stranded invite from a bad allocation.
		logErrorID(newErrorID(), "balance-precheck", err)
		return false
	}
	return sumGE(amounts, ev.StakeAmount)
}

// holdingCids returns the attendee's Holding contract ids for the instrument,
// used as AllocationFactory_Allocate inputs (§3.4).
func (s *Server) holdingCids(ctx context.Context, party, admin, instrumentID string) ([]string, error) {
	acs, err := s.ledger.ActiveContracts(ctx, party, []ledger.CumulativeFilter{{
		InterfaceFilter: &ledger.InterfaceFilter{
			InterfaceID:          ledger.HoldingInterfaceID,
			IncludeInterfaceView: true,
		},
	}})
	if err != nil {
		return nil, err
	}
	var cids []string
	for _, ac := range acs {
		raw, ok := ac.InterfaceViewValue("Splice.Api.Token.HoldingV1:Holding")
		if !ok {
			continue
		}
		var v struct {
			Owner        string `json:"owner"`
			InstrumentID struct {
				Admin string `json:"admin"`
				ID    string `json:"id"`
			} `json:"instrumentId"`
			Lock json.RawMessage `json:"lock"`
		}
		if json.Unmarshal(raw, &v) != nil {
			continue
		}
		// Locked Holdings cannot be spent as allocation inputs — including one
		// would pass the pre-check but fail allocate with a 502 (F10).
		if settle.IsLocked(v.Lock) {
			continue
		}
		if v.Owner == party && v.InstrumentID.Admin == admin && v.InstrumentID.ID == instrumentID {
			cids = append(cids, ac.CreatedEvent.ContractID)
		}
	}
	return cids, nil
}

// isAlreadyCheckedIn detects ONLY the CheckIn 'checkedIn' idempotency assert so
// a repeat check-in maps to a 200 no-op. The DB fast-path (rv.CheckedIn) already
// handles ordinary repeats; every other assert failure (withdrawn RSVP, ended
// event, stale Event cid, allocationCid None) must surface as a 502 rather than
// a false success — a broad 'already'/'assertion' match would let the organizer
// believe check-in succeeded and then slash the attendee at settlement (F6).
func isAlreadyCheckedIn(err error) bool {
	// The Daml assert message is "Already checked in" (ShowOrSow.daml CheckIn);
	// match the lowercased phrase — the old "checkedin" substring never matched
	// the real message, so the 200 no-op mapping could never fire.
	return strings.Contains(strings.ToLower(err.Error()), "already checked in")
}

// wrapExtra wraps a bare choiceContextData into the ExtraArgs {context, meta}
// record shape (mirrors settle.wrapExtraArgs, kept local to avoid export creep).
func wrapExtra(contextData json.RawMessage) json.RawMessage {
	if len(contextData) == 0 {
		// ExtraArgs.context is a ChoiceContext record, not Optional — the empty
		// value is {"values":{}}, never null (F9).
		contextData = json.RawMessage(`{"values":{}}`)
	}
	b, _ := json.Marshal(map[string]any{
		"context": json.RawMessage(contextData),
		"meta":    map[string]any{"values": map[string]any{}},
	})
	return b
}

// logAndID logs an error and returns a fresh searchable errorId.
func logAndID(stage string, err error) string {
	id := newErrorID()
	logErrorID(id, stage, err)
	return id
}
