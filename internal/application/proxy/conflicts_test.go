package proxy

import (
	"errors"
	"testing"

	"podux/internal/testutil"

	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
)

func newRecord(t *testing.T, app core.App, collection string, fields map[string]any) *core.Record {
	t.Helper()
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(c)
	r.Load(fields)
	return r
}

// conflictField returns the field of the validation error app.Save reported, or "".
func conflictField(err error) string {
	var verrs validation.Errors
	if !errors.As(err, &verrs) {
		return ""
	}
	for field := range verrs {
		return field
	}
	return ""
}

func TestProxyConflicts(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterConflictChecks(app)

	s1 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
	s2 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "b", "serverAddr": "2.2.2.2", "serverPort": 7000})
	proxy := func(server *core.Record, fields map[string]any) map[string]any {
		base := map[string]any{"serverId": server.Id, "status": "enabled", "bootStatus": "offline", "localPort": "80"}
		for k, v := range fields {
			base[k] = v
		}
		return base
	}
	testutil.SaveRecord(t, app, "fh_proxies", proxy(s1, map[string]any{"name": "ssh", "proxyType": "tcp", "remotePort": "6000"}))
	testutil.SaveRecord(t, app, "fh_proxies", proxy(s1, map[string]any{
		"name": "web", "proxyType": "http", "subdomain": "Blog", "customDomains": []string{"a.example.com"},
	}))

	cases := []struct {
		name   string
		fields map[string]any
		server *core.Record
		field  string // "" = must save
	}{
		{"same tcp port", map[string]any{"name": "x", "proxyType": "tcp", "remotePort": "6000"}, s1, "remotePort"},
		{"udp may share a tcp port", map[string]any{"name": "x", "proxyType": "udp", "remotePort": "6000"}, s1, ""},
		{"other server", map[string]any{"name": "x", "proxyType": "tcp", "remotePort": "6000"}, s2, ""},
		{"disabled is not checked", map[string]any{"name": "x", "proxyType": "tcp", "remotePort": "6000", "status": "disabled"}, s1, ""},
		{"random port", map[string]any{"name": "x", "proxyType": "tcp", "remotePort": "0"}, s1, ""},
		{"same subdomain, any case", map[string]any{"name": "x", "proxyType": "http", "subdomain": "blog"}, s1, "subdomain"},
		{"shared custom domain", map[string]any{"name": "x", "proxyType": "http", "customDomains": []string{"b.example.com", "A.example.com"}}, s1, "customDomains"},
		{"https may reuse an http domain", map[string]any{"name": "x", "proxyType": "https", "customDomains": []string{"a.example.com"}}, s1, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newRecord(t, app, "fh_proxies", proxy(tc.server, tc.fields))
			err := app.Save(r)
			if got := conflictField(err); got != tc.field {
				t.Fatalf("conflict field %q, want %q (err %v)", got, tc.field, err)
			}
			if err == nil {
				if err := app.Delete(r); err != nil {
					t.Fatal(err)
				}
			}
		})
	}

	// Editing a proxy must not conflict with itself.
	ssh, err := app.FindFirstRecordByData("fh_proxies", "name", "ssh")
	if err != nil {
		t.Fatal(err)
	}
	ssh.Set("description", "edited")
	if err := app.Save(ssh); err != nil {
		t.Fatalf("saving an unchanged proxy: %v", err)
	}
}

func TestVisitorConflicts(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterConflictChecks(app)

	s1 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
	s2 := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "b", "serverAddr": "2.2.2.2", "serverPort": 7000})
	visitor := func(server *core.Record, fields map[string]any) map[string]any {
		base := map[string]any{"serverId": server.Id, "visitorType": "stcp", "serverName": "p", "status": "enabled", "name": "x"}
		for k, v := range fields {
			base[k] = v
		}
		return base
	}
	testutil.SaveRecord(t, app, "fh_visitors", visitor(s1, map[string]any{"name": "nas", "bindPort": 6000}))

	cases := []struct {
		name   string
		fields map[string]any
		field  string
	}{
		{"same port, default address", map[string]any{"bindPort": 6000, "bindAddr": "127.0.0.1"}, "bindPort"},
		{"all interfaces overlaps", map[string]any{"bindPort": 6000, "bindAddr": "0.0.0.0"}, "bindPort"},
		{"another address", map[string]any{"bindPort": 6000, "bindAddr": "192.168.1.2"}, ""},
		{"another port", map[string]any{"bindPort": 6001}, ""},
		{"unbound", map[string]any{"bindPort": -1}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Visitors bind on this machine, so a conflict spans servers.
			r := newRecord(t, app, "fh_visitors", visitor(s2, tc.fields))
			err := app.Save(r)
			if got := conflictField(err); got != tc.field {
				t.Fatalf("conflict field %q, want %q (err %v)", got, tc.field, err)
			}
			if err == nil {
				if err := app.Delete(r); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
