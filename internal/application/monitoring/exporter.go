package monitoring

import (
	"bufio"
	"context"
	"io"
	"strconv"
	"strings"

	"podux/pkg/buildinfo"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Exporter writes the current state of servers and proxies in the Prometheus text format,
// from data Podux already collects: frpc status, latency probes, reachability probes
// and frps dashboard stats. Everything is a gauge; "today" traffic resets daily on frps.
type Exporter struct {
	app     core.App
	metrics *MetricsService
	frps    *FrpsService
	probes  *ProbeService
}

func NewExporter(app core.App, metrics *MetricsService, frps *FrpsService, probes *ProbeService) *Exporter {
	return &Exporter{app: app, metrics: metrics, frps: frps, probes: probes}
}

type sample struct {
	labels []string // name, value pairs
	value  float64
}

type family struct {
	name, help string
	samples    []sample
}

func (f *family) add(value float64, labels ...string) {
	f.samples = append(f.samples, sample{labels: labels, value: value})
}

func boolValue(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

func (x *Exporter) Write(ctx context.Context, w io.Writer) error {
	var servers []struct {
		ID         string `db:"id"`
		ServerName string `db:"serverName"`
		BootStatus string `db:"bootStatus"`
	}
	if err := x.app.DB().Select("id", "serverName", "bootStatus").From("fh_servers").
		OrderBy("serverName", "id").All(&servers); err != nil {
		return err
	}
	var proxies []struct {
		ID         string `db:"id"`
		Name       string `db:"name"`
		ProxyType  string `db:"proxyType"`
		Status     string `db:"status"`
		BootStatus string `db:"bootStatus"`
		ServerID   string `db:"serverId"`
	}
	if err := x.app.DB().Select("id", "name", "proxyType", "status", "bootStatus", "serverId").From("fh_proxies").
		OrderBy("serverId", "name", "id").All(&proxies); err != nil {
		return err
	}
	latency, err := x.metrics.GetLatestLatencyBatch()
	if err != nil {
		return err
	}
	var probes map[string]ProbeResult
	if x.probes != nil {
		probes = x.probes.Results()
	}

	info := &family{name: "podux_info", help: "Podux version; always 1."}
	info.add(1, "version", buildinfo.AppVersion)

	serverRunning := &family{name: "podux_server_running", help: "Whether frpc is running for the server (1) or not (0)."}
	serverReachable := &family{name: "podux_server_reachable", help: "Whether the last latency probe reached frps."}
	serverLatency := &family{name: "podux_server_latency_milliseconds", help: "Latency of the last successful probe to frps."}
	serverConns := &family{name: "podux_server_frps_connections", help: "Current connections on frps, from its dashboard."}
	serverClients := &family{name: "podux_server_frps_clients", help: "Clients connected to frps, from its dashboard."}
	serverIn := &family{name: "podux_server_today_traffic_in_bytes", help: "Traffic into frps today, from its dashboard."}
	serverOut := &family{name: "podux_server_today_traffic_out_bytes", help: "Traffic out of frps today, from its dashboard."}

	proxyEnabled := &family{name: "podux_proxy_enabled", help: "Whether the proxy is enabled in Podux."}
	proxyOnline := &family{name: "podux_proxy_online", help: "Whether frpc reports the proxy as started."}
	proxyReachable := &family{name: "podux_proxy_reachable", help: "Whether the last probe reached the proxy's public endpoint."}
	proxyConns := &family{name: "podux_proxy_connections", help: "Current connections to the proxy on frps."}
	proxyIn := &family{name: "podux_proxy_today_traffic_in_bytes", help: "Traffic into the proxy today, from frps."}
	proxyOut := &family{name: "podux_proxy_today_traffic_out_bytes", help: "Traffic out of the proxy today, from frps."}

	names := make(map[string]string, len(servers))
	traffic := map[string]ProxyTraffic{}
	for _, s := range servers {
		names[s.ID] = s.ServerName
		l := []string{"server_id", s.ID, "server", s.ServerName}
		serverRunning.add(boolValue(s.BootStatus == "running"), l...)
		if st := latency[s.ID]; st != nil {
			serverReachable.add(boolValue(st.Reachable), l...)
			if st.Reachable {
				serverLatency.add(float64(st.Latency), l...)
			}
		}
		if x.frps == nil {
			continue
		}
		stats, err := x.frps.ServerStats(ctx, s.ID)
		if err != nil || stats == nil {
			continue
		}
		if stats.Info != nil {
			serverConns.add(float64(stats.Info.CurConns), l...)
			serverClients.add(float64(stats.Info.ClientCounts), l...)
			serverIn.add(float64(stats.Info.TotalTrafficIn), l...)
			serverOut.add(float64(stats.Info.TotalTrafficOut), l...)
		}
		for id, t := range stats.Proxies {
			traffic[id] = t
		}
	}

	for _, p := range proxies {
		l := []string{"proxy_id", p.ID, "proxy", p.Name, "type", p.ProxyType, "server_id", p.ServerID, "server", names[p.ServerID]}
		proxyEnabled.add(boolValue(p.Status == "enabled"), l...)
		proxyOnline.add(boolValue(p.BootStatus == "online"), l...)
		if r, ok := probes[p.ID]; ok {
			proxyReachable.add(boolValue(r.Reachable), l...)
		}
		if t, ok := traffic[p.ID]; ok {
			proxyConns.add(float64(t.CurConns), l...)
			proxyIn.add(float64(t.TodayTrafficIn), l...)
			proxyOut.add(float64(t.TodayTrafficOut), l...)
		}
	}

	bw := bufio.NewWriter(w)
	for _, f := range []*family{
		info,
		serverRunning, serverReachable, serverLatency, serverConns, serverClients, serverIn, serverOut,
		proxyEnabled, proxyOnline, proxyReachable, proxyConns, proxyIn, proxyOut,
	} {
		writeFamily(bw, f)
	}
	return bw.Flush()
}

func writeFamily(w *bufio.Writer, f *family) {
	if len(f.samples) == 0 {
		return
	}
	w.WriteString("# HELP " + f.name + " " + f.help + "\n")
	w.WriteString("# TYPE " + f.name + " gauge\n")
	for _, s := range f.samples {
		w.WriteString(f.name)
		if len(s.labels) > 0 {
			w.WriteByte('{')
			for i := 0; i+1 < len(s.labels); i += 2 {
				if i > 0 {
					w.WriteByte(',')
				}
				w.WriteString(s.labels[i] + `="` + labelEscaper.Replace(s.labels[i+1]) + `"`)
			}
			w.WriteByte('}')
		}
		w.WriteString(" " + strconv.FormatFloat(s.value, 'f', -1, 64) + "\n")
	}
}

// labelEscaper escapes label values as the text exposition format requires.
var labelEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)
