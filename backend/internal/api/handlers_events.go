package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/store"
)

// createEventReq is the POST /api/events body.
type createEventReq struct {
	Title        string `json:"title"`
	Description  string `json:"description"`
	Venue        string `json:"venue"`
	ImageURL     string `json:"imageUrl"`
	StakeAmount  string `json:"stakeAmount"`
	TokenLabel   string `json:"tokenLabel"`
	RSVPDeadline string `json:"rsvpDeadline"` // RFC3339
	EventEnd     string `json:"eventEnd"`     // RFC3339
}

// POST /api/events — mints eventId, derives settleBefore = eventEnd +
// SETTLE_BUFFER, writes event_meta, then EventProposal + EP_Accept. The
// organizer is simply the logged-in user (their party owns the event).
func (s *Server) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	organizerParty := u.PartyID

	var req createEventReq
	if err := decodeBody(r, &req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid body")
		return
	}

	tok, ok := s.cfg.TokenByLabel(req.TokenLabel)
	if !ok {
		writeErr(w, http.StatusBadRequest, "unknown tokenLabel")
		return
	}
	rsvpDeadline, err := time.Parse(time.RFC3339, req.RSVPDeadline)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid rsvpDeadline")
		return
	}
	eventEnd, err := time.Parse(time.RFC3339, req.EventEnd)
	if err != nil {
		writeErr(w, http.StatusBadRequest, "invalid eventEnd")
		return
	}
	settleBefore := eventEnd.Add(s.cfg.SettleBuffer)

	eventID := newEventID()

	appOperatorParty := s.cfg.AppOperatorParty
	if appOperatorParty == "" {
		writeErr(w, http.StatusInternalServerError, "appOperator not configured")
		return
	}

	// Write event_meta BEFORE the ledger write (07 §1: meta lands first; joins
	// self-heal).
	if err := s.store.WriteEventMeta(ctx(r), store.EventMeta{
		EventID:     eventID,
		Description: req.Description,
		Venue:       req.Venue,
		ImageURL:    req.ImageURL,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "write event_meta: "+err.Error())
		return
	}

	// EventProposal create arguments (04 §1.1 — all Event fields, ended False).
	createArgs, _ := json.Marshal(map[string]any{
		"organizer":       organizerParty,
		"appOperator":     appOperatorParty,
		"eventId":         eventID,
		"title":           req.Title,
		"stakeAmount":     req.StakeAmount,
		"instrumentAdmin": tok.AdminParty,
		"instrumentId":    tok.InstrumentID,
		"rsvpDeadline":    rsvpDeadline.UTC().Format(time.RFC3339Nano),
		"eventEnd":        eventEnd.UTC().Format(time.RFC3339Nano),
		"settleBefore":    settleBefore.UTC().Format(time.RFC3339Nano),
		// NB: no "ended" — that field lives on Event, set to False by EP_Accept in
		// Daml. EventProposal has no such field; Canton 3.5 rejects unexpected keys.
	})

	// 1) EventProposal create as organizer.
	propResp, err := s.ledger.SubmitAndWait(ctx(r), organizerParty, "eventprop-"+newID(),
		[]ledger.Command{{CreateCommand: &ledger.CreateCommand{
			TemplateID:      s.pkg.TemplateID(ledger.TplEventProposal),
			CreateArguments: createArgs,
		}}}, nil)
	if err != nil {
		writeErr502(w, "create-eventproposal", "", err)
		return
	}
	propCid, ok := propResp.CreatedByTemplate(ledger.TplEventProposal)
	if !ok {
		writeErr502(w, "create-eventproposal", "", errors.New("no EventProposal created"))
		return
	}

	// 2) EP_Accept as appOperator → creates Event.
	acceptResp, err := s.ledger.SubmitAndWait(ctx(r), appOperatorParty, "epaccept-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplEventProposal),
			ContractID:     propCid,
			Choice:         "EP_Accept",
			ChoiceArgument: json.RawMessage(`{}`),
		}}}, nil)
	if err != nil {
		writeErr502(w, "ep-accept", "", err)
		return
	}
	_, _ = acceptResp.CreatedByTemplate(ledger.TplEvent) // cid tracked by indexer E1

	writeJSON(w, http.StatusOK, map[string]string{"eventId": eventID})
}

// eventView is the shared event/meta shape in responses.
type eventView struct {
	EventID         string    `json:"eventId"`
	ContractID      string    `json:"contractId"`
	OrganizerParty  string    `json:"organizerParty"`
	Title           string    `json:"title"`
	StakeAmount     string    `json:"stakeAmount"`
	InstrumentAdmin string    `json:"instrumentAdmin"`
	InstrumentID    string    `json:"instrumentId"`
	RSVPDeadline    time.Time `json:"rsvpDeadline"`
	EventEnd        time.Time `json:"eventEnd"`
	SettleBefore    time.Time `json:"settleBefore"`
	Status          string    `json:"status"`
}

type metaView struct {
	Description string `json:"description"`
	Venue       string `json:"venue"`
	ImageURL    string `json:"imageUrl"`
}

func toEventView(e *store.EventRow) eventView {
	return eventView{
		EventID:         e.EventID,
		ContractID:      e.ContractID,
		OrganizerParty:  e.OrganizerParty,
		Title:           e.Title,
		StakeAmount:     e.StakeAmount,
		InstrumentAdmin: e.InstrumentAdmin,
		InstrumentID:    e.InstrumentID,
		RSVPDeadline:    e.RSVPDeadline,
		EventEnd:        e.EventEnd,
		SettleBefore:    e.SettleBefore,
		Status:          e.Status,
	}
}

func toMetaView(e *store.EventRow) metaView {
	return metaView{Description: e.Description, Venue: e.Venue, ImageURL: e.ImageURL}
}

// GET /api/events — read model, user-scoped (07 §3). A user sees events they
// organize (organizer_party = their party) plus events where they hold an rsvps
// row. myStatus is set for any event where they have an RSVP.
func (s *Server) handleListEvents(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	party := u.PartyID

	rows, err := s.store.ListEventsForUser(ctx(r), party)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	type item struct {
		Event    eventView `json:"event"`
		Meta     metaView  `json:"meta"`
		MyStatus string    `json:"myStatus,omitempty"`
	}
	out := make([]item, 0, len(rows))
	for i := range rows {
		e := &rows[i]
		it := item{Event: toEventView(e), Meta: toMetaView(e)}
		// myStatus reflects the user's own RSVP where one exists (an organizer
		// viewing their own event usually has none).
		if rsvp, err := s.store.GetRSVP(ctx(r), e.EventID, party); err == nil {
			it.MyStatus = rsvp.Status
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/events/{eventId} — role-adaptive (07 §3):
//   - organizer → {event, meta, stats, rsvps:[...]}
//   - attendee  → {event, meta, myRsvp:{...}}
func (s *Server) handleGetEvent(w http.ResponseWriter, r *http.Request) {
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

	// Organizer view — the logged-in user owns the event.
	if party == ev.OrganizerParty {
		stats, err := s.store.GetEventStats(ctx(r), eventID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		rsvps, err := s.store.ListRSVPsForEvent(ctx(r), eventID)
		if err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Row shape pinned with the web build (05 §2 / 08 §2): the invitee's real
		// name + email drive the row, {attendeeParty} drives the check-in POST.
		type rsvpOut struct {
			AttendeeParty string `json:"attendeeParty"`
			AttendeeName  string `json:"attendeeName"`
			AttendeeEmail string `json:"attendeeEmail"`
			Status        string `json:"status"`
			CheckedIn     bool   `json:"checkedIn"`
			RSVPCid       string `json:"rsvpCid"`
			SlotID        string `json:"slotId"`
		}
		rout := make([]rsvpOut, 0, len(rsvps))
		for _, rv := range rsvps {
			// Resolve the invitee's account for name + email. slotId is the
			// invitee's email by construction (handleInvite), so it is the email
			// fallback when the account lookup misses.
			name, email := "", rv.SlotID
			if acct, err := s.users.GetByParty(ctx(r), rv.AttendeeParty); err == nil {
				name, email = acct.DisplayName, acct.Email
			}
			rout = append(rout, rsvpOut{
				AttendeeParty: rv.AttendeeParty,
				AttendeeName:  name,
				AttendeeEmail: email,
				Status:        rv.Status,
				CheckedIn:     rv.CheckedIn,
				RSVPCid:       rv.RSVPCID,
				SlotID:        rv.SlotID,
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"event": toEventView(ev),
			"meta":  toMetaView(ev),
			"stats": map[string]any{
				"headcount":      stats.Headcount,
				"checkedInCount": stats.CheckedInCount,
				"tvl":            stats.TVL,
				"potBalance":     stats.PotBalance,
			},
			"rsvps": rout,
		})
		return
	}

	// Attendee view — their own rsvps row (privacy: only their own visible).
	rsvp, err := s.store.GetRSVP(ctx(r), eventID, party)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusOK, map[string]any{
			"event":  toEventView(ev),
			"meta":   toMetaView(ev),
			"myRsvp": nil,
		})
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"event": toEventView(ev),
		"meta":  toMetaView(ev),
		"myRsvp": map[string]any{
			"status":    rsvp.Status,
			"checkedIn": rsvp.CheckedIn,
			"inviteCid": rsvp.InviteCID,
			"rsvpCid":   rsvp.RSVPCID,
			"slotId":    rsvp.SlotID,
		},
	})
}
