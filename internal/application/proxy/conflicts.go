package proxy

import (
	"fmt"
	"slices"
	"strings"

	proxydomain "podux/internal/domain/proxy"
	"podux/internal/domain/visitor"

	"github.com/pocketbase/dbx"
	validation "github.com/pocketbase/ozzo-validation/v4"
	"github.com/pocketbase/pocketbase/core"
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
//   - http/https proxies on one server sharing a subdomain or custom domain
//   - visitors on any server listening on the same local address and port
//
// Disabled records are not checked, so an alternative config can be kept disabled.
func RegisterConflictChecks(app core.App) {
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

func proxyConflicts(app core.App, r *core.Record) error {
	if r.GetString("status") != string(proxydomain.ProxyStatusEnabled) {
		return nil
	}
	proxyType := r.GetString("proxyType")
	switch proxyType {
	case "tcp", "udp", "http", "https":
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

	if proxyType == "tcp" || proxyType == "udp" {
		port := r.GetInt("remotePort")
		if port <= 0 {
			return nil // 0 lets frps pick a free port
		}
		for _, o := range others {
			if o.GetInt("remotePort") == port {
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
		other := bindAddr(o)
		if addr == other || addr == "0.0.0.0" || other == "0.0.0.0" {
			return validation.Errors{"bindPort": conflictError(CodeBindConflict,
				fmt.Sprintf("Local port %d is already used by visitor %q.", port, o.GetString("name")),
				o.GetString("name"))}
		}
	}
	return nil
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
