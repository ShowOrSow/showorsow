package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/showorsow/backend/internal/config"
)

func testServer(secret string) *Server {
	return &Server{cfg: &config.Config{SessionSecret: []byte(secret)}}
}

// TestSessionRoundTrip asserts the HMAC session cookie round-trips: a signed
// user id verifies back to the same id (05 §2 — the cookie now carries the user
// id, not a persona name).
func TestSessionRoundTrip(t *testing.T) {
	s := testServer("unit-test-secret")
	for _, id := range []int64{1, 42, 9223372036854775807} {
		tok := s.signSession(id)
		got, ok := s.verifySession(tok)
		if !ok {
			t.Fatalf("verifySession(sign(%d)) failed to verify", id)
		}
		if got != id {
			t.Fatalf("round-trip id = %d, want %d", got, id)
		}
	}
}

// TestVerifySessionRejectsTampered asserts any mutation of the payload or the
// signature is rejected — a tampered cookie must not resolve to a user.
func TestVerifySessionRejectsTampered(t *testing.T) {
	s := testServer("unit-test-secret")
	valid := s.signSession(7)

	bad := []struct {
		name  string
		value string
	}{
		{"empty", ""},
		{"no separator", "7abcd"},
		{"payload swapped (sig no longer matches)", "8." + valid[len("7."):]},
		{"garbage signature", "7.not-a-valid-signature"},
		{"non-numeric id", "abc." + valid[len("7."):]},
		{"truncated signature", valid[:len(valid)-2]},
	}
	for _, b := range bad {
		t.Run(b.name, func(t *testing.T) {
			if _, ok := s.verifySession(b.value); ok {
				t.Fatalf("verifySession(%q) accepted a tampered/invalid cookie", b.value)
			}
		})
	}
}

// TestVerifySessionWrongSecret asserts a cookie signed under a different secret
// does not verify (the HMAC binds the id to SESSION_SECRET).
func TestVerifySessionWrongSecret(t *testing.T) {
	signer := testServer("secret-A")
	verifier := testServer("secret-B")
	tok := signer.signSession(5)
	if _, ok := verifier.verifySession(tok); ok {
		t.Fatal("cookie signed under secret-A verified under secret-B")
	}
}

// TestCurrentUserIDFromCookie asserts the end-to-end cookie extraction path used
// by requireUser: set the cookie, read it back off the request.
func TestCurrentUserIDFromCookie(t *testing.T) {
	s := testServer("unit-test-secret")

	rec := httptest.NewRecorder()
	s.setSessionCookie(rec, 123)
	cookie := rec.Result().Cookies()[0]
	if cookie.Name != sessionCookieName {
		t.Fatalf("cookie name = %q, want %q", cookie.Name, sessionCookieName)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.AddCookie(cookie)
	id, ok := s.currentUserID(req)
	if !ok || id != 123 {
		t.Fatalf("currentUserID = (%d,%v), want (123,true)", id, ok)
	}

	// No cookie → unauthenticated.
	if _, ok := s.currentUserID(httptest.NewRequest(http.MethodGet, "/", nil)); ok {
		t.Fatal("currentUserID resolved a user with no cookie present")
	}
}
