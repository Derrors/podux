package utils

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// PingResult latency probe result
type PingResult struct {
	Latency   int64  // Latency in milliseconds, -1 means unreachable
	Reachable bool   // Whether the host is reachable
	Error     string // Error message if any
}

// GeoLocation IP geolocation information
type GeoLocation struct {
	Country     string  `json:"country"`     // Country name
	CountryCode string  `json:"countryCode"` // Country code (e.g., CN, US)
	Region      string  `json:"region"`      // Province/State/Region
	City        string  `json:"city"`        // City name
	ISP         string  `json:"isp"`         // Internet Service Provider
	Latitude    float64 `json:"lat"`         // Latitude coordinate
	Longitude   float64 `json:"lon"`         // Longitude coordinate
}

// PingHost tests host latency via TCP connection
func PingHost(addr string, timeout time.Duration) PingResult {
	return PingHostContext(context.Background(), addr, timeout)
}

func PingHostContext(ctx context.Context, addr string, timeout time.Duration) PingResult {
	if addr == "" {
		return PingResult{
			Latency:   -1,
			Reachable: false,
			Error:     "empty address",
		}
	}

	// If address doesn't contain port, default to 7000
	if _, _, err := net.SplitHostPort(addr); err != nil {
		addr = net.JoinHostPort(strings.Trim(addr, "[]"), "7000")
	}

	start := time.Now()
	conn, err := (&net.Dialer{Timeout: timeout}).DialContext(ctx, "tcp", addr)
	elapsed := time.Since(start).Milliseconds()

	if err != nil {
		return PingResult{
			Latency:   -1,
			Reachable: false,
			Error:     err.Error(),
		}
	}

	conn.Close()
	return PingResult{
		Latency:   elapsed,
		Reachable: true,
		Error:     "",
	}
}

// GetGeoLocation retrieves IP geolocation information (using free public API)
func GetGeoLocation(addr string) (*GeoLocation, error) {
	return GetGeoLocationContext(context.Background(), addr)
}

func GetGeoLocationContext(ctx context.Context, addr string) (*GeoLocation, error) {
	// Resolve IP address (resolve domain name if needed)
	ip, err := resolveAddrContext(ctx, addr)
	if err != nil {
		return nil, fmt.Errorf("resolve address failed: %w", err)
	}

	// Return directly for private IP addresses
	if isPrivateIP(ip) {
		return &GeoLocation{
			Country:     "Private Network",
			CountryCode: "LAN",
			Region:      "Local",
			City:        "Local",
			ISP:         "Private",
		}, nil
	}

	// Query using ip-api.com (free, no key required, 45 requests/min)
	return publicGeo.lookup(ctx, ip)
}

// resolveAddr resolves address and extracts IP
func resolveAddr(addr string) (string, error) { return resolveAddrContext(context.Background(), addr) }
func resolveAddrContext(ctx context.Context, addr string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	// Remove port number
	host := strings.Trim(addr, "[]")
	if h, _, err := net.SplitHostPort(addr); err == nil {
		host = h
	}

	// Return directly if already an IP address
	if net.ParseIP(host) != nil {
		return host, nil
	}

	// DNS resolution
	ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return "", err
	}

	if len(ips) == 0 {
		return "", fmt.Errorf("no IP found for %s", host)
	}

	// Prefer IPv4 address
	for _, ip := range ips {
		if ipv4 := ip.To4(); ipv4 != nil {
			return ipv4.String(), nil
		}
	}

	// Return first IP if no IPv4 found
	return ips[0].String(), nil
}

// isPrivateIP checks if an IP is private
func isPrivateIP(ip string) bool {
	parsedIP := net.ParseIP(ip)
	if parsedIP == nil {
		return false
	}

	return parsedIP.IsPrivate() || parsedIP.IsLoopback() || parsedIP.IsLinkLocalUnicast() || !parsedIP.IsGlobalUnicast()
}

// A process-wide gate enforces <=45 public requests/minute without burst
// tokens. Waiting and HTTP are cancellable; the IP-keyed cache deduplicates both
// concurrent host aliases and repeated failures. No lookup spawns a goroutine.
const geoRequestSpacing = time.Minute/45 + time.Millisecond

type publicGeoEntry struct {
	location *GeoLocation
	err      error
	expires  time.Time
}
type geoAPI struct {
	once  sync.Once
	gate  chan struct{}
	cache map[string]publicGeoEntry
	next  time.Time
	fetch func(context.Context, string) (*GeoLocation, error)
}

var publicGeo = &geoAPI{fetch: getGeoLocationFromAPI}

func (g *geoAPI) lookup(ctx context.Context, ip string) (*GeoLocation, error) {
	g.once.Do(func() { g.gate = make(chan struct{}, 1); g.cache = make(map[string]publicGeoEntry) })
	select {
	case g.gate <- struct{}{}:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	defer func() { <-g.gate }()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if item, ok := g.cache[ip]; ok && time.Now().Before(item.expires) {
		return cloneGeo(item.location), item.err
	}
	if delay := time.Until(g.next); delay > 0 {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	g.next = time.Now().Add(geoRequestSpacing)
	location, err := g.fetch(ctx, ip)
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	ttl := 24 * time.Hour
	if err != nil {
		ttl = time.Minute
	}
	if len(g.cache) >= 4096 {
		for key, item := range g.cache {
			if time.Now().After(item.expires) {
				delete(g.cache, key)
			}
		}
		if len(g.cache) >= 4096 {
			for key := range g.cache {
				delete(g.cache, key)
				break
			}
		}
	}
	g.cache[ip] = publicGeoEntry{cloneGeo(location), err, time.Now().Add(ttl)}
	return location, err
}
func cloneGeo(location *GeoLocation) *GeoLocation {
	if location == nil {
		return nil
	}
	out := *location
	return &out
}

// getGeoLocationFromAPI retrieves geolocation information from ip-api.com
func getGeoLocationFromAPI(ctx context.Context, ip string) (*GeoLocation, error) {
	// ip-api.com API endpoint
	url := fmt.Sprintf("http://ip-api.com/json/%s?fields=status,country,countryCode,region,regionName,city,isp,lat,lon", ip)

	client := &http.Client{
		Timeout: 5 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status: %d", resp.StatusCode)
	}

	var apiResp struct {
		Status      string  `json:"status"`
		Country     string  `json:"country"`
		CountryCode string  `json:"countryCode"`
		Region      string  `json:"region"`
		RegionName  string  `json:"regionName"`
		City        string  `json:"city"`
		ISP         string  `json:"isp"`
		Lat         float64 `json:"lat"`
		Lon         float64 `json:"lon"`
	}

	if err := json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&apiResp); err != nil {
		return nil, fmt.Errorf("parse API response failed: %w", err)
	}

	if apiResp.Status != "success" {
		return nil, fmt.Errorf("API query failed for IP: %s", ip)
	}

	return &GeoLocation{
		Country:     apiResp.Country,
		CountryCode: apiResp.CountryCode,
		Region:      apiResp.RegionName, // Use RegionName (e.g., "Guangdong") instead of Region (e.g., "GD")
		City:        apiResp.City,
		ISP:         apiResp.ISP,
		Latitude:    apiResp.Lat,
		Longitude:   apiResp.Lon,
	}, nil
}
