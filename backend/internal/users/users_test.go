package users

import (
	"regexp"
	"testing"
)

// TestSlugifyEmailLocal pins the party-hint slugging rules (task item 1): the
// email local part becomes a lowercase [a-z0-9-] token, separator runs collapse
// to a single dash, edges are trimmed, length is capped, and the empty case
// falls back to a non-empty stub.
func TestSlugifyEmailLocal(t *testing.T) {
	cases := []struct {
		name  string
		email string
		want  string
	}{
		{"simple", "alice@showorsow.dev", "alice"},
		{"uppercase lowered", "Organizer@showorsow.dev", "organizer"},
		{"dot separator", "alice.b@x.io", "alice-b"},
		{"plus tag", "alice+tag@x.io", "alice-tag"},
		{"mixed separators collapse", "a.b_c+d@x.io", "a-b-c-d"},
		{"leading/trailing separators trimmed", ".alice.@x.io", "alice"},
		{"digits kept", "user42@x.io", "user42"},
		{"no at sign uses whole string", "bob", "bob"},
		{"all separators fall back", "...@x.io", "user"},
		{"empty local falls back", "@x.io", "user"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := slugifyEmailLocal(c.email); got != c.want {
				t.Fatalf("slugifyEmailLocal(%q) = %q, want %q", c.email, got, c.want)
			}
		})
	}
}

// TestSlugifyEmailLocalCapAndCharset asserts the length cap and that the output
// only ever contains hint-safe characters, with no dash at the edges.
func TestSlugifyEmailLocalCapAndCharset(t *testing.T) {
	long := "this-is-a-very-long-email-local-part-well-over-the-cap"
	got := slugifyEmailLocal(long + "@x.io")
	if len(got) > 32 {
		t.Fatalf("slug %q length %d exceeds cap 32", got, len(got))
	}
	safe := regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	if !safe.MatchString(got) {
		t.Fatalf("slug %q is not hint-safe (no edge/double dashes, [a-z0-9-] only)", got)
	}
}

// TestShortSuffix asserts the disambiguating suffix is a stable-length hex token
// and varies between calls (so hint-collision retries actually change the hint).
func TestShortSuffix(t *testing.T) {
	a := shortSuffix()
	if len(a) != 6 {
		t.Fatalf("shortSuffix len = %d, want 6", len(a))
	}
	if !regexp.MustCompile(`^[0-9a-f]{6}$`).MatchString(a) {
		t.Fatalf("shortSuffix %q is not 6 hex chars", a)
	}
	distinct := false
	for i := 0; i < 8; i++ {
		if shortSuffix() != a {
			distinct = true
			break
		}
	}
	if !distinct {
		t.Fatal("shortSuffix returned the same value across calls; hint retries would loop")
	}
}

// TestNormalizeEmail asserts case/whitespace folding so lookups and the
// UNIQUE(email) constraint treat variants as one account.
func TestNormalizeEmail(t *testing.T) {
	cases := map[string]string{
		"  Alice@Showorsow.Dev ": "alice@showorsow.dev",
		"BOB@X.IO":               "bob@x.io",
		"already@lower.dev":      "already@lower.dev",
	}
	for in, want := range cases {
		if got := normalizeEmail(in); got != want {
			t.Fatalf("normalizeEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

// TestDemoAccountsPinned guards the frontend contract: the seeded demo emails
// are hardcoded in the web dev-login strip (08 §2 / AuthForms.tsx). Drifting
// them silently breaks one-click demo login.
func TestDemoAccountsPinned(t *testing.T) {
	want := map[string]string{
		"organizer@showorsow.dev": "Organizer",
		"alice@showorsow.dev":     "Alice",
		"bob@showorsow.dev":       "Bob",
		"charlie@showorsow.dev":   "Charlie",
	}
	if len(DemoAccounts) != len(want) {
		t.Fatalf("DemoAccounts has %d entries, want %d", len(DemoAccounts), len(want))
	}
	for _, d := range DemoAccounts {
		name, ok := want[d.Email]
		if !ok {
			t.Fatalf("unexpected demo email %q (must be pinned to the frontend list)", d.Email)
		}
		if d.Name != name {
			t.Fatalf("demo %q name = %q, want %q", d.Email, d.Name, name)
		}
	}
}
