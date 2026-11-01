package notify

import "testing"

func TestForgetProbeResetsOnlyPublicProbeAlerts(t *testing.T) {
	s, _, sent := newTestService(t, "en", nil)
	failed := []ProbeState{
		{ID: "ssh", Name: "ssh", Endpoint: "example.com:6022"},
		{ID: "web", Name: "web", Endpoint: "example.com:6080"},
	}
	for range failThreshold {
		s.ObserveProbes("srv", "home", failed)
	}
	if len(*sent) != 1 {
		t.Fatalf("expected one grouped alert, got %v", events(*sent))
	}
	// frpc offline alerts are separate and must survive public-probe opt-out.
	s.servers["srv"].proxies["ssh"] = &proxyState{offline: 2, alerted: true}
	s.ForgetProbe("ssh")
	s.ForgetProbe("missing")
	if s.servers["srv"].probes["ssh"] != nil || !s.servers["srv"].probes["web"].alerted ||
		!s.servers["srv"].proxies["ssh"].alerted || len(*sent) != 1 {
		t.Fatal("opt-out affected other probe/tunnel alerts or sent a recovery")
	}
	// Re-enabling starts a fresh failure sequence, not a continuation of the old alert.
	for range failThreshold - 1 {
		s.ObserveProbes("srv", "home", failed)
	}
	if len(*sent) != 1 {
		t.Fatal("re-enabled probe inherited its old failure count")
	}
	s.ObserveProbes("srv", "home", failed)
	if len(*sent) != 2 {
		t.Fatal("fresh consecutive failures no longer raise an alert")
	}
	s.ForgetProbe("ssh")
	failed[0].Reachable = true
	s.ObserveProbes("srv", "home", failed)
	if len(*sent) != 2 {
		t.Fatal("first success after re-enabling generated a spurious recovery")
	}
}
