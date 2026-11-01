package utils

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

func TestPublicGeoRateLimitAndDeduplication(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		var starts []time.Time
		g := &geoAPI{fetch: func(context.Context, string) (*GeoLocation, error) {
			starts = append(starts, time.Now())
			return &GeoLocation{City: "test"}, nil
		}}
		var wg sync.WaitGroup
		for range 12 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := g.lookup(context.Background(), "same-ip"); err != nil {
					t.Error(err)
				}
			}()
		}
		wg.Wait()
		if len(starts) != 1 {
			t.Fatalf("concurrent lookup cache miss issued %d requests", len(starts))
		}
		for i := range 50 {
			if _, err := g.lookup(context.Background(), fmt.Sprintf("ip-%d", i)); err != nil {
				t.Fatal(err)
			}
		}
		for i := 1; i < len(starts); i++ {
			if starts[i].Sub(starts[i-1]) < geoRequestSpacing {
				t.Fatal("public API burst")
			}
		}
		if starts[45].Sub(starts[0]) < time.Minute {
			t.Fatal("more than 45 requests in rolling minute")
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		before := len(starts)
		if _, err := g.lookup(ctx, "cancelled"); err != context.Canceled {
			t.Fatal(err)
		}
		if len(starts) != before {
			t.Fatal("cancelled request consumed API call")
		}
	})
}
func TestNetworkContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if r := PingHostContext(ctx, "127.0.0.1:7000", time.Minute); r.Reachable || r.Error == "" {
		t.Fatal("cancelled dial succeeded")
	}
	if _, err := GetGeoLocationContext(ctx, "unused.invalid"); !errors.Is(err, context.Canceled) {
		t.Fatalf("DNS did not respect cancellation: %v", err)
	}
	for _, ip := range []string{"::1", "fc00::1", "fe80::1", "127.0.0.1", "10.0.0.1"} {
		if !isPrivateIP(ip) {
			t.Fatalf("private IP sent to public API: %s", ip)
		}
	}
}
