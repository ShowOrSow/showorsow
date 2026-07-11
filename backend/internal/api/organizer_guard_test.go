package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/showorsow/backend/internal/config"
	"github.com/showorsow/backend/internal/store"
	"github.com/showorsow/backend/internal/users"
)

// ---- fakes (organizer-guard wiring only) ----

// fakeUserStore satisfies userStore. Only GetByID is exercised by the guard;
// the rest are inert stubs so the interface is fully implemented.
type fakeUserStore struct {
	byID map[int64]*users.User
}

func (f *fakeUserStore) Register(context.Context, string, string, string) (*users.User, error) {
	return nil, users.ErrEmailTaken
}
func (f *fakeUserStore) Authenticate(context.Context, string, string) (*users.User, error) {
	return nil, users.ErrInvalidCredentials
}
func (f *fakeUserStore) DevLogin(context.Context, string) (*users.User, error) {
	return nil, users.ErrNotFound
}
func (f *fakeUserStore) GetByID(_ context.Context, id int64) (*users.User, error) {
	if u, ok := f.byID[id]; ok {
		return u, nil
	}
	return nil, users.ErrNotFound
}
func (f *fakeUserStore) GetByEmail(context.Context, string) (*users.User, error) {
	return nil, users.ErrNotFound
}
func (f *fakeUserStore) GetByParty(context.Context, string) (*users.User, error) {
	return nil, users.ErrNotFound
}
func (f *fakeUserStore) DisplayNameForParty(_ context.Context, party string) string { return party }

// fakeDataStore satisfies dataStore. Only GetEvent matters for the guard.
type fakeDataStore struct {
	events map[string]*store.EventRow
}

func (f *fakeDataStore) WriteEventMeta(context.Context, store.EventMeta) error { return nil }
func (f *fakeDataStore) GetEvent(_ context.Context, eventID string) (*store.EventRow, error) {
	if e, ok := f.events[eventID]; ok {
		return e, nil
	}
	return nil, store.ErrNotFound
}
func (f *fakeDataStore) ListEventsForUser(context.Context, string) ([]store.EventRow, error) {
	return nil, nil
}
func (f *fakeDataStore) GetRSVP(context.Context, string, string) (*store.RSVPRow, error) {
	return nil, store.ErrNotFound
}
func (f *fakeDataStore) GetRSVPByCid(context.Context, string) (*store.RSVPRow, error) {
	return nil, store.ErrNotFound
}
func (f *fakeDataStore) GetRSVPByInviteCid(context.Context, string) (*store.RSVPRow, error) {
	return nil, store.ErrNotFound
}
func (f *fakeDataStore) ListRSVPsForEvent(context.Context, string) ([]store.RSVPRow, error) {
	return nil, nil
}
func (f *fakeDataStore) GetEventStats(context.Context, string) (*store.EventStats, error) {
	return nil, store.ErrNotFound
}
func (f *fakeDataStore) GetSettlementPackage(context.Context, string) ([]store.SettlementRow, error) {
	return nil, nil
}
func (f *fakeDataStore) GetBalanceDeltas(context.Context, string) ([]store.BalanceDeltaRow, error) {
	return nil, nil
}

// TestRequireOrganizer is the table-driven organizer-guard test (task item 3 /
// F1): only the event's organizer (session party == events.organizer_party) may
// pass; everyone else is stopped BEFORE any ledger write.
func TestRequireOrganizer(t *testing.T) {
	const (
		orgParty   = "organizer::1220org"
		otherParty = "alice::1220alice"
		orgUID     = int64(1)
		otherUID   = int64(2)
	)
	us := &fakeUserStore{byID: map[int64]*users.User{
		orgUID:   {ID: orgUID, Email: "organizer@showorsow.dev", DisplayName: "Organizer", PartyID: orgParty},
		otherUID: {ID: otherUID, Email: "alice@showorsow.dev", DisplayName: "Alice", PartyID: otherParty},
	}}
	ds := &fakeDataStore{events: map[string]*store.EventRow{
		"ev-1": {EventID: "ev-1", OrganizerParty: orgParty},
	}}
	s := &Server{cfg: &config.Config{SessionSecret: []byte("guard-test-secret")}, users: us, store: ds}

	cases := []struct {
		name       string
		cookie     string // "" = no cookie; "bad" = tampered; else signed uid
		uid        int64
		eventID    string
		wantStatus int
		wantOK     bool
	}{
		{name: "organizer passes", uid: orgUID, eventID: "ev-1", wantStatus: http.StatusOK, wantOK: true},
		{name: "non-organizer forbidden", uid: otherUID, eventID: "ev-1", wantStatus: http.StatusForbidden},
		{name: "event not found", uid: orgUID, eventID: "missing", wantStatus: http.StatusNotFound},
		{name: "unauthenticated (no cookie)", cookie: "none", eventID: "ev-1", wantStatus: http.StatusUnauthorized},
		{name: "tampered cookie", cookie: "bad", eventID: "ev-1", wantStatus: http.StatusUnauthorized},
		{name: "cookie for deleted user", uid: 999, eventID: "ev-1", wantStatus: http.StatusUnauthorized},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/events/"+c.eventID+"/checkin", nil)
			switch c.cookie {
			case "none":
				// no cookie attached
			case "bad":
				req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: "7.tampered-signature"})
			default:
				req.AddCookie(&http.Cookie{Name: sessionCookieName, Value: s.signSession(c.uid)})
			}
			rec := httptest.NewRecorder()

			u, ev, ok := s.requireOrganizer(rec, req, c.eventID)
			if ok != c.wantOK {
				t.Fatalf("ok = %v, want %v", ok, c.wantOK)
			}
			if rec.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, c.wantStatus)
			}
			if c.wantOK {
				if u == nil || u.PartyID != orgParty {
					t.Fatalf("expected organizer user, got %+v", u)
				}
				if ev == nil || ev.OrganizerParty != orgParty {
					t.Fatalf("expected event owned by organizer, got %+v", ev)
				}
			} else if u != nil || ev != nil {
				t.Fatalf("guard failed but returned non-nil user/event: u=%+v ev=%+v", u, ev)
			}
		})
	}
}
