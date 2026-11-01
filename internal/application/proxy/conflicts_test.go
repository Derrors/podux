package proxy

import (
	"errors"
	"testing"

	"podux/internal/testutil"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
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
		{"xtcp shares tcp port space", map[string]any{"visitorType": "xtcp", "bindPort": 6000}, "bindPort"},
		{"sudp uses separate udp port space", map[string]any{"visitorType": "sudp", "bindPort": 6000}, ""},
		{"mapped ipv4 is the same address", map[string]any{"bindPort": 6000, "bindAddr": "::ffff:127.0.0.1"}, "bindPort"},
		{"ipv6 wildcard overlaps", map[string]any{"bindPort": 6000, "bindAddr": "::"}, "bindPort"},
		{"ipv6 loopback is separate", map[string]any{"bindPort": 6000, "bindAddr": "::1"}, ""},
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

func TestVisitorIPv6AndUDPConflicts(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterConflictChecks(app)
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
	fields := func(name, typ, addr string) map[string]any {
		return map[string]any{"name": name, "visitorType": typ, "serverId": s.Id, "serverName": "p", "status": "enabled", "bindAddr": addr, "bindPort": 6000}
	}
	testutil.SaveRecord(t, app, "fh_visitors", fields("udp", "sudp", "::1"))
	for _, tc := range []struct{ name, typ, addr, field string }{
		{"same udp", "sudp", "0:0:0:0:0:0:0:1", "bindPort"},
		{"udp wildcard", "sudp", "::", "bindPort"},
		{"dual stack wildcard", "sudp", "0.0.0.0", "bindPort"},
		{"tcp separate", "stcp", "::1", ""},
		{"udp ipv4 separate", "sudp", "127.0.0.1", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := newRecord(t, app, "fh_visitors", fields("candidate", tc.typ, tc.addr))
			err := app.Save(r)
			if conflictField(err) != tc.field {
				t.Fatalf("save=%v, want field %q", err, tc.field)
			}
			if err == nil {
				if err := app.Delete(r); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}

func TestProxySharingMatchesGeneratedOptions(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterConflictChecks(app)
	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
	for _, typ := range []string{"tcp", "udp", "http", "https", "tcpmux"} {
		for _, exception := range []string{"load balancer", "HTTP user"} {
			t.Run(typ+"/"+exception, func(t *testing.T) {
				fields := map[string]any{
					"serverId": s.Id, "name": "first", "proxyType": typ, "status": "enabled", "bootStatus": "offline",
					"localPort": 80, "remotePort": 6000, "customDomains": []string{"shared.example.com"},
				}
				if exception == "load balancer" {
					fields["options"] = map[string]any{"loadBalancer": map[string]any{"group": "g", "groupKey": "k"}}
				}
				first := testutil.SaveRecord(t, app, "fh_proxies", fields)
				fields["name"] = "second"
				if exception == "HTTP user" {
					fields["options"] = map[string]any{"routeByHTTPUser": "bob"}
				}
				second := newRecord(t, app, "fh_proxies", fields)
				err := app.Save(second)
				// Match frpc.proxyOptionKeys, not just upstream capabilities:
				// HTTPS loadBalancer is not currently exported to the runtime.
				mayShare := exception == "load balancer" && (typ == "tcp" || typ == "http" || typ == "tcpmux") || exception == "HTTP user" && (typ == "http" || typ == "tcpmux")
				if mayShare {
					if err != nil {
						t.Fatalf("supported sharing rejected: %v", err)
					}
					if err := app.Delete(second); err != nil {
						t.Fatal(err)
					}
				} else {
					want := "customDomains"
					if typ == "tcp" || typ == "udp" {
						want = "remotePort"
					}
					if conflictField(err) != want {
						t.Fatalf("unsupported sharing save=%v, want %s conflict", err, want)
					}
				}
				if err := app.Delete(first); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestProxyConflictExceptions(t *testing.T) {
	app := testutil.NewApp(t)
	RegisterConflictChecks(app)

	s := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "a", "serverAddr": "1.1.1.1", "serverPort": 7000})
	base := func(fields map[string]any) map[string]any {
		out := map[string]any{"serverId": s.Id, "status": "enabled", "bootStatus": "offline", "localPort": 80}
		for k, v := range fields {
			out[k] = v
		}
		return out
	}
	lb := map[string]any{"loadBalancer": map[string]any{"group": "web", "groupKey": "k"}}
	testutil.SaveRecord(t, app, "fh_proxies", base(map[string]any{"name": "a", "proxyType": "tcp", "remotePort": 6000, "options": lb}))
	testutil.SaveRecord(t, app, "fh_proxies", base(map[string]any{
		"name": "api", "proxyType": "http", "customDomains": []string{"x.example.com"},
		"options": map[string]any{"locations": []string{"/api"}},
	}))
	testutil.SaveRecord(t, app, "fh_proxies", base(map[string]any{"name": "m", "proxyType": "tcpmux", "customDomains": []string{"m.example.com"}}))

	cases := []struct {
		name   string
		fields map[string]any
		field  string
	}{
		{"same load balancing group", map[string]any{"proxyType": "tcp", "remotePort": 6000, "options": lb}, ""},
		{"other group key", map[string]any{"proxyType": "tcp", "remotePort": 6000,
			"options": map[string]any{"loadBalancer": map[string]any{"group": "web", "groupKey": "other"}}}, "remotePort"},
		{"other location", map[string]any{"proxyType": "http", "customDomains": []string{"x.example.com"}}, ""},
		{"same location", map[string]any{"proxyType": "http", "customDomains": []string{"x.example.com"},
			"options": map[string]any{"locations": []string{"/api", "/v2"}}}, "customDomains"},
		{"routed by another user", map[string]any{"proxyType": "http", "customDomains": []string{"x.example.com"},
			"options": map[string]any{"locations": []string{"/api"}, "routeByHTTPUser": "bob"}}, ""},
		{"tcpmux domain", map[string]any{"proxyType": "tcpmux", "customDomains": []string{"m.example.com"}}, "customDomains"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := newRecord(t, app, "fh_proxies", base(tc.fields))
			r.Set("name", "new")
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
