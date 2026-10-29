package utils

import (
	"net"
	"testing"
)

func TestResolveAddrStripsPort(t *testing.T) {
	cases := map[string]string{
		"1.2.3.4:7000":       "1.2.3.4",
		"1.2.3.4":            "1.2.3.4",
		"[2001:db8::1]:7000": "2001:db8::1",
		"2001:db8::1":        "2001:db8::1",
	}
	for in, want := range cases {
		got, err := resolveAddr(in)
		if err != nil || got != want {
			t.Errorf("resolveAddr(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
}

func TestPingHostIPv6(t *testing.T) {
	ln, err := net.Listen("tcp", "[::1]:0")
	if err != nil {
		t.Skip("IPv6 loopback unavailable:", err)
	}
	defer ln.Close()

	if res := PingHost(ln.Addr().String(), 0); !res.Reachable {
		t.Fatalf("PingHost(%s) unreachable: %s", ln.Addr(), res.Error)
	}
}
