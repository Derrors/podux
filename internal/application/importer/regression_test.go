package importer

import (
	"podux/internal/testutil"
	"testing"
)

func TestOverwritePreservesPoduxAndRuntimeFields(t *testing.T) {
	app := testutil.NewApp(t)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "keep", "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "running", "autoConnection": true, "description": "keep-description"})
	p := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{"name": "plain", "proxyType": "tcp", "serverId": server.Id, "remotePort": 6000, "status": "disabled", "bootStatus": "online", "description": "keep-description", "probeDisabled": true, "plugin": map[string]any{"type": "socks5"}, "options": map[string]any{"httpPassword": "synthetic-option"}, "healthCheck": map[string]any{"type": "tcp"}})
	fb := testutil.SaveRecord(t, app, "fh_visitors", map[string]any{"name": "relay", "visitorType": "stcp", "serverId": server.Id, "serverName": "remote", "bindPort": -1, "status": "enabled"})
	v := testutil.SaveRecord(t, app, "fh_visitors", map[string]any{"name": "visitor", "visitorType": "xtcp", "serverId": server.Id, "serverName": "remote", "bindPort": 6001, "status": "disabled", "description": "keep-description", "fallbackTo": fb.Id, "fallbackTimeoutMs": 900})
	src := `serverAddr = '127.0.0.1'
[[proxies]]
name = 'plain'
localPort = 8080
remotePort = 6000
[[visitors]]
name = 'visitor'
type = 'xtcp'
serverName = 'remote'
bindPort = 6001
`
	_, err := NewService(app).ExecuteImport(&ExecuteImportRequest{TomlContent: src, ImportServer: true, OverwriteServer: true, ImportVisitors: true, OverwriteVisitors: true, Proxies: []ProxyImportOption{{Name: "plain", Import: true, Overwrite: true}}})
	if err != nil {
		t.Fatal(err)
	}
	server, _ = app.FindRecordById("fh_servers", server.Id)
	p, _ = app.FindRecordById("fh_proxies", p.Id)
	v, _ = app.FindRecordById("fh_visitors", v.Id)
	if server.GetString("bootStatus") != "running" || !server.GetBool("autoConnection") || server.GetString("description") != "keep-description" {
		t.Fatal("server runtime/Podux fields overwritten")
	}
	if p.GetString("bootStatus") != "online" || p.GetString("status") != "disabled" || !p.GetBool("probeDisabled") || p.GetString("description") != "keep-description" {
		t.Fatal("proxy runtime/Podux fields overwritten")
	}
	for _, key := range []string{"plugin", "healthCheck", "options"} {
		var obj map[string]any
		if err := p.UnmarshalJSONField(key, &obj); err != nil {
			t.Fatal(err)
		}
		if len(obj) != 0 {
			t.Fatalf("omitted %s survived overwrite", key)
		}
	}
	if v.GetString("status") != "disabled" || v.GetString("description") != "keep-description" || v.GetString("fallbackTo") != "" || v.GetInt("fallbackTimeoutMs") != 0 {
		t.Fatal("visitor overwrite failed to preserve Podux fields or clear optional fields")
	}
}

func TestPrivateProxyVisitorTargetRemapping(t *testing.T) {
	for _, tc := range []struct {
		name, sourceUser, targetUser, storedUser string
		importProxy, overwriteServer             bool
		wantMapped                               bool
		wantUser                                 string
	}{
		{name: "same-file", sourceUser: "home", storedUser: "home", importProxy: true, wantMapped: true, wantUser: "home"},
		{name: "explicit-same", sourceUser: "home", targetUser: "home", storedUser: "home", importProxy: true, wantMapped: true, wantUser: "home"},
		{name: "external-user", sourceUser: "home", targetUser: "other", storedUser: "home", importProxy: true, wantUser: "other"},
		{name: "unimported", sourceUser: "home", storedUser: "home", wantUser: ""},
		{name: "different-existing-user", sourceUser: "home", storedUser: "office", importProxy: true, wantMapped: true, wantUser: "office"},
		{name: "external-keeps-source-user", sourceUser: "home", storedUser: "office", wantUser: "home"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "fixture", "serverAddr": "127.0.0.1", "serverPort": 7000, "user": tc.storedUser})
			src := "serverAddr = '127.0.0.1'\nuser = '" + tc.sourceUser + "'\n[[proxies]]\nname = 'private'\ntype = 'stcp'\nlocalPort = 8080\n[[visitors]]\nname = 'client'\ntype = 'stcp'\nserverName = 'private'\nserverUser = '" + tc.targetUser + "'\nbindPort = 6000\n"
			_, err := NewService(app).ExecuteImport(&ExecuteImportRequest{TomlContent: src, ImportVisitors: true, Proxies: []ProxyImportOption{{Name: "private", Import: tc.importProxy}}})
			if err != nil {
				t.Fatal(err)
			}
			visitor, err := app.FindFirstRecordByData("fh_visitors", "name", "client")
			if err != nil {
				t.Fatal(err)
			}
			want := "private"
			if tc.wantMapped {
				p, err := app.FindFirstRecordByData("fh_proxies", "name", "private")
				if err != nil {
					t.Fatal(err)
				}
				want += "-" + p.Id
			}
			if visitor.GetString("serverName") != want || visitor.GetString("serverUser") != tc.wantUser {
				t.Fatal("visitor target identity was not preserved")
			}
		})
	}
}

func TestImportedNoneAuthDoesNotReviveUnusedToken(t *testing.T) {
	cfg := tomlFrpClientConfig{Auth: tomlAuthConfig{Method: "none", Token: "synthetic-unused-token"}}
	if err := normalizeImportedCommon(&cfg); err != nil {
		t.Fatal(err)
	}
	if cfg.Auth.Method != "token" || cfg.Auth.Token != "" {
		t.Fatal("none auth revived a dormant token")
	}
}

func TestImportRejectsInvalidCommonBeforeSaving(t *testing.T) {
	app := testutil.NewApp(t)
	_, err := NewService(app).ExecuteImport(&ExecuteImportRequest{ImportServer: true, TomlContent: "serverAddr='127.0.0.1'\nauth.method='unsupported'"})
	if err == nil {
		t.Fatal("invalid auth method accepted")
	}
	records, _ := app.FindAllRecords("fh_servers")
	if len(records) != 0 {
		t.Fatal("failed import left a record")
	}
}
