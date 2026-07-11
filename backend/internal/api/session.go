package api

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strings"
	"time"
)

// Session is demo-grade auth (deliberate & documented, 05 §2): a signed cookie
// holding the active persona name. No expiry logic beyond the cookie's own —
// this is not production auth.

const sessionCookieName = "sos_session"

// signPersona produces "<persona>.<base64url(hmac)>".
func (s *Server) signPersona(persona string) string {
	mac := hmac.New(sha256.New, s.cfg.SessionSecret)
	mac.Write([]byte(persona))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return persona + "." + sig
}

// verifyPersona checks the signature and returns the persona name.
func (s *Server) verifyPersona(value string) (string, bool) {
	i := strings.LastIndexByte(value, '.')
	if i < 0 {
		return "", false
	}
	persona, sig := value[:i], value[i+1:]
	mac := hmac.New(sha256.New, s.cfg.SessionSecret)
	mac.Write([]byte(persona))
	want := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(sig), []byte(want)) {
		return "", false
	}
	return persona, true
}

// setSessionCookie writes the signed session cookie.
func (s *Server) setSessionCookie(w http.ResponseWriter, persona string) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    s.signPersona(persona),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Expires:  time.Now().Add(24 * time.Hour),
	})
}

// currentPersona extracts and verifies the persona from the request cookie.
func (s *Server) currentPersona(r *http.Request) (string, bool) {
	c, err := r.Cookie(sessionCookieName)
	if err != nil {
		return "", false
	}
	return s.verifyPersona(c.Value)
}
