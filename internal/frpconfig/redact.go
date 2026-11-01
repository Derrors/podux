package frpconfig

import (
	"encoding/json"
	"net/url"
	"strings"
)

const RedactedValue = "<redacted>"

var secretKeys = map[string]bool{
	"token": true, "password": true, "secretkey": true, "clientsecret": true,
	"httppassword": true, "httppwd": true, "pwd": true, "sk": true,
	"oidctoken": true, "oidcclientsecret": true, "groupkey": true,
	"authorization": true, "proxyauthorization": true, "cookie": true, "setcookie": true,
	"accesskey": true, "apikey": true, "accesstoken": true, "refreshtoken": true,
	"privatekey": true,
}

func normalizedKey(k string) string {
	return strings.NewReplacer("_", "", "-", "").Replace(strings.ToLower(k))
}

// Plain makes an isolated JSON-shaped copy. Redaction operates on decoded values,
// not on JSON text, so escaping and key casing cannot bypass it.
func Plain(v any, includeSecrets bool) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	if !includeSecrets {
		out = Redact(out)
	}
	return out, nil
}

func Redact(v any) any {
	switch x := v.(type) {
	case map[string]any:
		for k, value := range x {
			if secretKeys[normalizedKey(k)] {
				if s, ok := value.(string); ok && s != "" {
					x[k] = RedactedValue
					continue
				}
			}
			x[k] = Redact(value)
		}
	case []any:
		for i := range x {
			x[i] = Redact(x[i])
		}
	case string:
		if strings.Contains(x, "-----BEGIN") {
			return RedactedValue
		}
		// URL userinfo is secret regardless of which field contains the URL. Also
		// redact credential-bearing query parameters (OIDC endpoints, HTTP headers).
		u, err := url.Parse(x)
		if err != nil {
			if strings.Contains(x, "://") && strings.Contains(x, "@") {
				return RedactedValue
			}
			return x
		}
		if u.Scheme == "" || u.Host == "" {
			return x
		}
		changed := false
		if u.User != nil {
			u.User = url.User(RedactedValue)
			changed = true
		}
		q := u.Query()
		for k := range q {
			if secretKeys[normalizedKey(k)] {
				q.Set(k, RedactedValue)
				changed = true
			}
		}
		if changed {
			u.RawQuery = q.Encode()
			return u.String()
		}
	}
	return v
}
