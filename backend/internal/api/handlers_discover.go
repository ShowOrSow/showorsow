package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/showorsow/backend/internal/ledger"
	"github.com/showorsow/backend/internal/store"
)

// GET /api/discover — the PUBLIC event feed. Anyone (logged in or not) can
// browse open events; only the aggregate "N going" is exposed, never who.
// This is the privacy story in one endpoint: the event is public, the guest
// list is not — attendees are never observers of each other's contracts, so
// even our own indexer cannot join them together for a stranger.
func (s *Server) handleDiscover(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListDiscoverableEvents(ctx(r))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	going, err := s.store.CountStakedByEvent(ctx(r))
	if err != nil {
		// Non-fatal: the feed is still useful without the counts.
		going = map[string]int{}
	}

	// myStatus is filled only for a logged-in viewer, so the same feed serves
	// both the signed-out landing browse and the signed-in "Register" state.
	// Auth is OPTIONAL here — a missing/!valid cookie just means no personal
	// state, never a 401 (discovery must work signed-out).
	var party string
	if uid, ok := s.currentUserID(r); ok {
		if u, err := s.users.GetByID(ctx(r), uid); err == nil {
			party = u.PartyID
		}
	}

	type item struct {
		Event       eventView `json:"event"`
		Meta        metaView  `json:"meta"`
		Going       int       `json:"going"`
		HostLabel   string    `json:"hostLabel,omitempty"`
		MyStatus    string    `json:"myStatus,omitempty"`
		IsOrganizer bool      `json:"isOrganizer,omitempty"`
	}
	out := make([]item, 0, len(rows))
	for i := range rows {
		e := &rows[i]
		it := item{
			Event:     toEventView(e),
			Meta:      toMetaView(e),
			Going:     going[e.EventID],
			HostLabel: s.labelForParty(ctx(r), e.OrganizerParty),
		}
		if party != "" {
			it.IsOrganizer = party == e.OrganizerParty
			if rsvp, err := s.store.GetRSVP(ctx(r), e.EventID, party); err == nil {
				it.MyStatus = rsvp.Status
			}
		}
		out = append(out, it)
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /api/events/{eventId}/join — self-service RSVP from the discovery feed.
// No invite needed: the backend hosts every user party, so it exercises
// InviteAttendee AS THE ORGANIZER on the caller's behalf, producing exactly the
// same RSVPInvite an organizer-sent invite would. The caller then stakes
// through the normal accept flow, so there is ONE staking path, not two.
// Idempotent: an existing RSVP is returned as-is rather than duplicated.
func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request) {
	u, ok := s.requireUser(w, r)
	if !ok {
		return
	}
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
	if ev.OrganizerParty == u.PartyID {
		writeJSON(w, http.StatusConflict, errBody{
			Error: "you host this event", Stage: "join",
			Detail: "organizers don't RSVP to their own events",
		})
		return
	}
	if ev.Status != "open" {
		writeJSON(w, http.StatusConflict, errBody{
			Error: "registration closed", Stage: "join",
			Detail: "this event is no longer open for RSVPs",
		})
		return
	}

	// Already have an RSVP → nothing to do; the event page shows its state.
	if _, err := s.store.GetRSVP(ctx(r), eventID, u.PartyID); err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"eventId": eventID, "joined": true})
		return
	}

	// slotId keys the RSVP slot on-ledger; the user's email is stable + unique
	// per event, matching what organizer-sent invites use.
	arg, _ := json.Marshal(map[string]any{"attendee": u.PartyID, "slotId": u.Email})
	if _, err := s.ledger.SubmitAndWait(ctx(r), ev.OrganizerParty, "join-"+newID(),
		[]ledger.Command{{ExerciseCommand: &ledger.ExerciseCommand{
			TemplateID:     s.pkg.TemplateID(ledger.TplEvent),
			ContractID:     ev.ContractID,
			Choice:         "InviteAttendee",
			ChoiceArgument: arg,
		}}}, nil); err != nil {
		writeErr502(w, "join-event", "", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"eventId": eventID, "joined": true})
}
