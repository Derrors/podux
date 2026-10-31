package apikey

import (
	"testing"

	"podux/internal/testutil"
)

func TestAuthenticate(t *testing.T) {
	app := testutil.NewApp(t)
	s := NewService(app)

	key, token, err := s.Create("ci", ScopeWrite)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Authenticate(token)
	if err != nil || got == nil || got.ID != key.ID || got.Scope != ScopeWrite {
		t.Fatalf("authenticate: %+v %v", got, err)
	}
	// The first use is recorded.
	if keys, _ := s.List(); len(keys) != 1 || keys[0].LastUsedAt == "" {
		t.Errorf("lastUsedAt not recorded: %+v", keys)
	}
	for _, bad := range []string{"", "pdx_", token + "x", token[:len(token)-1], "not-a-key"} {
		if got, err := s.Authenticate(bad); got != nil || err != nil {
			t.Errorf("authenticate %q: %+v %v", bad, got, err)
		}
	}
}

func TestAllows(t *testing.T) {
	cases := []struct {
		scope, required string
		want            bool
	}{
		{ScopeRead, ScopeRead, true},
		{ScopeRead, ScopeWrite, false},
		{ScopeWrite, ScopeRead, true},
		{ScopeWrite, ScopeWrite, true},
		{"", ScopeRead, false},
	}
	for _, c := range cases {
		if got := Allows(c.scope, c.required); got != c.want {
			t.Errorf("Allows(%q, %q) = %v", c.scope, c.required, got)
		}
	}
}
