package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// Session is a signed cookie carrying the logged-in user's id (Luma-style real
// accounts, pivot Jul 11 — replaces the persona name the cookie used to hold,
// 05 §2). The HMAC binds the id to the server's SESSION_SECRET; the cookie is
// HttpOnly so nothing ledger-related reaches JS.

const sessionCookieName = "sos_session"

// signSession produces "<userID>.<base64url(hmac)>".
func (s *Server) signSession(userID int64) string {
	id := strconv.FormatInt(userID, 10)
	mac := hmac.New(sha256.New, s.cfg.SessionSecret)
	mac.Write([]byte(id))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return id + "." + sig
}

// verifySession checks the signature and returns the user id.
func (s *Server) verifySession(value string) (int64, bool) {
	i := strings.LastIndexByte(value, '.')
	if i < 0 {
		return 0, false
	}
	id, sig := value[:i], value[i+1:]
	mac := hmac.New(sha256.New, s.cfg.SessionSecret)
	mac.Write([]byte(id))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(want)) {
		return 0, false
	}
	uid, err := strconv.ParseInt(id, 10, 64)
	if err != nil {
		return 0, false
	}
	return uid, true
}

// setSessionCookie writes the signed session cookie for a user id.
func (s *Server) setSessionCookie(w http.ResponseWriter, userID int64) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    s.signSession(userID),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(24 * time.Hour),
	})
}

// clearSessionCookie expires the session cookie (logout).
func (s *Server) clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

// currentUserID extracts and verifies the user id from the request cookie.
func (s *Server) currentUserID(r *http.Request) (int64, bool) {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return 0, false
	}
	return s.verifySession(c.Value)
}
