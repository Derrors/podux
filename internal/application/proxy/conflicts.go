package proxy

import (
	"fmt"
	"net/netip"
	"slices"
	"strings"

	proxydomain "podux/internal/domain/proxy"
	"podux/internal/domain/visitor"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/hook"
)

// Validation error codes returned in the PocketBase error data; the UI translates them.
const (
	CodePortConflict   = "validation_port_conflict"
	CodeDomainConflict = "validation_domain_conflict"
	CodeBindConflict   = "validation_bind_conflict"
)

// RegisterConflictChecks rejects saving an enabled proxy or visitor that frps or
// the local machine would refuse at runtime, so the error shows up in the form
// instead of only in the frpc log:
//   - tcp/udp proxies on one server sharing a remote port (tcp and udp ports are separate)
//   - http/https/tcpmux proxies on one server sharing a subdomain or custom domain
//     (http only when they also share a location)
//   - visitors on any server listening on the same local address, transport and port
//
// TCP/HTTP/TCPMux proxies in the same load balancing group (same group and group
// key) may share a port or domain, as may HTTP/TCPMux proxies routed by different
// users. Disabled records are not checked, so an alternative config can be kept disabled.
func RegisterConflictChecks(app core.App) {
	// OnRecordValidate alone is too late to acquire a lock that also covers
	// persistence. Wrap the create/update pipeline before PB's field hooks
	// (priority -99), including validation and the actual SQL write.
	for _, h := range []*hook.TaggedHook[*core.RecordEvent]{
		app.OnRecordCreate("fh_proxies", "fh_visitors"),
		app.OnRecordUpdate("fh_proxies", "fh_visitors"),
	} {
		h.Bind(&hook.Handler[*core.RecordEvent]{
			Id: "poduxConflictWriteTransaction", Priority: -100, Func: transactionalRecordWrite,
		})
	}
	app.OnRecordValidate("fh_proxies").BindFunc(func(e *core.RecordEvent) error {
		if err := proxyConflicts(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	app.OnRecordValidate("fh_visitors").BindFunc(func(e *core.RecordEvent) error {
		if err := visitorConflicts(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
}

// transactionalRecordWrite uses PocketBase's bounded single writer connection,
// not a process-wide mutex. RunInTransaction reuses e.App when a batch/import
// already owns the transaction. Restore e.App before returning: standalone
// after-success hooks must run against the live app, not a committed txApp.
func transactionalRecordWrite(e *core.RecordEvent) error {
	originalApp := e.App
	defer func() { e.App = originalApp }()
	return originalApp.RunInTransaction(func(tx core.App) error {
		e.App = tx
		return e.Next()
	})
}

func proxyConflicts(app core.App, r *core.Record) error {
	if r.GetString("status") != string(proxydomain.ProxyStatusEnabled) {
		return nil
	}
	proxyType := r.GetString("proxyType")
	switch proxyType {
	case "tcp", "udp", "http", "https", "tcpmux":
	default:
		return nil
	}

	others, err := app.FindAllRecords("fh_proxies", dbx.HashExp{
		"serverId":  r.GetString("serverId"),
		"proxyType": proxyType,
		"status":    string(proxydomain.ProxyStatusEnabled),
	}, dbx.Not(dbx.HashExp{"id": r.Id}))
	if err != nil {
		return err
	}
	opts := optionsOf(r)

	if proxyType == "tcp" || proxyType == "udp" {
		port := r.GetInt("remotePort")
		if port <= 0 {
			return nil // 0 lets frps pick a free port
		}
		for _, o := range others {
			if o.GetInt("remotePort") == port && !opts.sharesWith(optionsOf(o), proxyType) {
				return validation.Errors{"remotePort": conflictError(CodePortConflict,
					fmt.Sprintf("Remote %s port %d is already used by proxy %q.", proxyType, port, o.GetString("name")),
					o.GetString("name"))}
			}
		}
		return nil
	}

	subdomain := strings.ToLower(strings.TrimSpace(r.GetString("subdomain")))
	domains := lowerAll(r.GetStringSlice("customDomains"))
	for _, o := range others {
		other := optionsOf(o)
		if opts.sharesWith(other, proxyType) || (proxyType == "http" && !overlaps(opts.locations(), other.locations())) {
			continue
		}
		if subdomain != "" && strings.EqualFold(strings.TrimSpace(o.GetString("subdomain")), subdomain) {
			return validation.Errors{"subdomain": conflictError(CodeDomainConflict,
				fmt.Sprintf("Subdomain %q is already used by proxy %q.", subdomain, o.GetString("name")),
				o.GetString("name"))}
		}
		otherDomains := lowerAll(o.GetStringSlice("customDomains"))
		for _, d := range domains {
			if slices.Contains(otherDomains, d) {
				return validation.Errors{"customDomains": conflictError(CodeDomainConflict,
					fmt.Sprintf("Domain %q is already used by proxy %q.", d, o.GetString("name")),
					o.GetString("name"))}
			}
		}
	}
	return nil
}

// proxyOptions is the part of fh_proxies.options that decides whether two proxies
// may share a port or domain.
type proxyOptions struct {
	LoadBalancer struct {
		Group    string `json:"group"`
		GroupKey string `json:"groupKey"`
	} `json:"loadBalancer"`
	Locations       []string `json:"locations"`
	RouteByHTTPUser string   `json:"routeByHTTPUser"`
}

func optionsOf(r *core.Record) proxyOptions {
	var o proxyOptions
	_ = r.UnmarshalJSONField("options", &o)
	return o
}

// sharesWith follows the options actually exported by frpc.proxyOptionKeys:
// TCP/HTTP/TCPMux support loadBalancer; only HTTP/TCPMux route by HTTP user.
// Although frp supports HTTPS groups, Podux currently omits their options;
// accepting them here would permit a conflict in the generated config.
func (o proxyOptions) sharesWith(other proxyOptions, proxyType string) bool {
	if proxyType != "tcp" && proxyType != "http" && proxyType != "tcpmux" {
		return false
	}
	if o.LoadBalancer.Group != "" && o.LoadBalancer.Group == other.LoadBalancer.Group &&
		o.LoadBalancer.GroupKey == other.LoadBalancer.GroupKey {
		return true
	}
	return (proxyType == "http" || proxyType == "tcpmux") && o.RouteByHTTPUser != other.RouteByHTTPUser
}

// locations defaults to the catch-all location frp uses when none is set.
func (o proxyOptions) locations() []string {
	if len(o.Locations) == 0 {
		return []string{""}
	}
	return o.Locations
}

func overlaps(a, b []string) bool {
	for _, x := range a {
		if slices.Contains(b, x) {
			return true
		}
	}
	return false
}

func visitorConflicts(app core.App, r *core.Record) error {
	if r.GetString("status") != visitor.StatusEnabled {
		return nil
	}
	port := r.GetInt("bindPort")
	if port <= 0 {
		return nil // not bound; only reachable from other visitors
	}

	others, err := app.FindAllRecords("fh_visitors", dbx.HashExp{
		"bindPort": port,
		"status":   visitor.StatusEnabled,
	}, dbx.Not(dbx.HashExp{"id": r.Id}))
	if err != nil {
		return err
	}
	addr := bindAddr(r)
	for _, o := range others {
		if visitorTransport(r) != visitorTransport(o) {
			continue
		}
		if bindAddrsOverlap(addr, bindAddr(o)) {
			return validation.Errors{"bindPort": conflictError(CodeBindConflict,
				fmt.Sprintf("Local port %d is already used by visitor %q.", port, o.GetString("name")),
				o.GetString("name"))}
		}
	}
	return nil
}

// STCP and XTCP both accept local TCP connections; only SUDP binds UDP.
func visitorTransport(r *core.Record) string {
	if r.GetString("visitorType") == "sudp" {
		return "udp"
	}
	return "tcp"
}

func bindAddrsOverlap(a, b string) bool {
	left, leftErr := netip.ParseAddr(a)
	right, rightErr := netip.ParseAddr(b)
	if leftErr != nil || rightErr != nil {
		// Do not resolve hostnames here: DNS is mutable and must not block a
		// write transaction. Only identical names can be checked statically.
		return strings.EqualFold(a, b)
	}
	left, right = left.Unmap(), right.Unmap()
	if left.IsUnspecified() || right.IsUnspecified() {
		// frpc uses net.Listen("tcp") / ListenUDP("udp"), not tcp4/tcp6.
		// Go's wildcard listeners may be dual-stack, even for 0.0.0.0.
		// Reserve both families conservatively rather than admit a conflict
		// whose outcome depends on the host's IPv6/IPv4-mapping support.
		return true
	}
	return left == right
}

// bindAddr is the visitor's listen address, defaulting like frpc config generation does.
func bindAddr(r *core.Record) string {
	if a := strings.TrimSpace(r.GetString("bindAddr")); a != "" {
		return a
	}
	return "127.0.0.1"
}

func conflictError(code, message, otherName string) validation.Error {
	return validation.NewError(code, message).SetParams(map[string]any{"name": otherName})
}

func lowerAll(values []string) []string {
	out := make([]string, 0, len(values))
	for _, v := range values {
		if v = strings.ToLower(strings.TrimSpace(v)); v != "" {
			out = append(out, v)
		}
	}
	return out
}
