package httphandler

import (
	"context"
	"encoding/json"
	"fmt"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"net"
	"net/http"
	"net/http/httptest"
	"podux/internal/application/monitoring"
	"strconv"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"podux/internal/testutil"
)

func TestMonitoringHTTPDoesNotWaitForRemoteDashboard(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)
	release := make(chan struct{})
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
		_, _ = w.Write([]byte(`{"vhostHTTPPort":8080}`))
	}))
	defer remote.Close()
	defer close(release)
	server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": "blocked", "serverAddr": "127.0.0.1", "serverPort": 7000, "dashboard": map[string]any{"url": remote.URL}})
	for _, path := range []string{"/api/dashboard/stats", "/api/proxies/status", "/api/servers/" + server.Id + "/frps", "/api/metrics"} {
		began := time.Now()
		response := do(t, h, http.MethodGet, path, token, "")
		if response.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body)
		}
		if elapsed := time.Since(began); elapsed > time.Second {
			t.Fatalf("%s waited on remote I/O: %s", path, elapsed)
		}
	}
}
func TestProxyStatusServerFilterAlsoFiltersProbes(t *testing.T) {
	app := testutil.NewApp(t)
	token := userToken(t, app)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			conn.Close()
		}
	}()
	_, portText, _ := net.SplitHostPort(listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	servers := []*core.Record{}
	proxies := []*core.Record{}
	for i := range 2 {
		server := testutil.SaveRecord(t, app, "fh_servers", map[string]any{"serverName": fmt.Sprintf("s%d", i), "serverAddr": "127.0.0.1", "serverPort": 7000, "bootStatus": "running"})
		servers = append(servers, server)
		proxy := testutil.SaveRecord(t, app, "fh_proxies", map[string]any{"serverId": server.Id, "name": fmt.Sprintf("p%d", i), "proxyType": "tcp", "status": "enabled", "bootStatus": "online", "remotePort": port})
		proxies = append(proxies, proxy)
	}
	frps := monitoring.NewFrpsService(app)
	defer frps.Stop()
	probe := monitoring.NewProbeService(app, frps)
	defer probe.Stop()
	probe.ProbeAll(context.Background())
	if len(probe.Results()) != 2 {
		t.Fatal("probe fixture incomplete")
	}
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	NewMonitorHandler(app, frps, probe).RegisterHandlers(&core.ServeEvent{App: app, Router: router})
	handler, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	response := do(t, handler, http.MethodGet, "/api/proxies/status?serverId="+servers[0].Id, token, "")
	var out struct {
		Proxies map[string]proxyStatus `json:"proxies"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &out) != nil {
		t.Fatalf("status: %s", response.Body)
	}
	if len(out.Proxies) != 1 || out.Proxies[proxies[0].Id].Probe == nil {
		t.Fatalf("foreign probe leaked into filtered status: %+v", out.Proxies)
	}
}

func TestServerOptionsBeyond500(t *testing.T) {
	app, h := newTestRouter(t)
	token := userToken(t, app)
	if err := app.RunInTransaction(func(tx core.App) error {
		for i := range 513 {
			_, err := tx.DB().Insert("fh_servers", dbx.Params{"id": fmt.Sprintf("option%09d", i), "serverName": "option", "serverAddr": "127.0.0.1", "serverPort": 7000}).Execute()
			if err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	response := do(t, h, http.MethodGet, "/api/servers/options", token, "")
	var options []serverOptionVO
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &options) != nil {
		t.Fatalf("options: %d %s", response.Code, response.Body)
	}
	if len(options) != 513 {
		t.Fatalf("options truncated: %d", len(options))
	}
}
