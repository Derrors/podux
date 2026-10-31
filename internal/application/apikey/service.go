// Package apikey manages API keys: long random tokens for scripts and Prometheus.
// A key only unlocks the routes that opt in with its scope; it is never a user session.
package apikey

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

const (
	ScopeRead  = "read"
	ScopeWrite = "write"

	collection = "fh_api_keys"
	// tokenPrefix marks Podux API keys, so they are told apart from session tokens.
	tokenPrefix = "pdx_"
	// shownPrefix is how much of a key is stored in clear to recognize it in the UI.
	shownPrefix = len(tokenPrefix) + 8
	maxNameLen  = 100
	// touchEvery limits lastUsedAt writes: Prometheus may scrape every few seconds.
	touchEvery = time.Minute
)

var (
	ErrInvalidName  = errors.New("name is required and at most 100 characters")
	ErrInvalidScope = errors.New("scope must be read or write")
	ErrNotFound     = errors.New("api key not found")
)

// Key is an API key as listed; the token itself is only returned by Create.
type Key struct {
	ID         string `json:"id" db:"id"`
	Name       string `json:"name" db:"name"`
	Prefix     string `json:"prefix" db:"prefix"`
	Scope      string `json:"scope" db:"scope"`
	LastUsedAt string `json:"lastUsedAt" db:"lastUsedAt"`
	Created    string `json:"created" db:"created"`
}

type Service struct {
	app core.App

	mu      sync.Mutex
	touched map[string]time.Time
}

func NewService(app core.App) *Service {
	return &Service{app: app, touched: map[string]time.Time{}}
}

// IsKey reports whether a bearer token looks like a Podux API key.
func IsKey(token string) bool { return strings.HasPrefix(token, tokenPrefix) }

// Allows reports whether a key with scope may make a request that needs required.
// A write key can also read.
func Allows(scope, required string) bool {
	return scope == ScopeWrite || (scope == ScopeRead && required == ScopeRead)
}

func hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Service) List() ([]Key, error) {
	keys := []Key{}
	err := s.app.DB().Select("id", "name", "prefix", "scope", "lastUsedAt", "created").
		From(collection).OrderBy("created DESC").All(&keys)
	return keys, err
}

// Create stores a new key and returns it with its token, which is not kept anywhere.
func (s *Service) Create(name, scope string) (*Key, string, error) {
	name = strings.TrimSpace(name)
	if name == "" || len([]rune(name)) > maxNameLen {
		return nil, "", ErrInvalidName
	}
	if scope != ScopeRead && scope != ScopeWrite {
		return nil, "", ErrInvalidScope
	}
	coll, err := s.app.FindCollectionByNameOrId(collection)
	if err != nil {
		return nil, "", err
	}

	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, "", err
	}
	token := tokenPrefix + base64.RawURLEncoding.EncodeToString(buf)

	r := core.NewRecord(coll)
	r.Set("name", name)
	r.Set("keyHash", hash(token))
	r.Set("prefix", token[:shownPrefix])
	r.Set("scope", scope)
	if err := s.app.Save(r); err != nil {
		return nil, "", err
	}
	return &Key{
		ID:      r.Id,
		Name:    name,
		Prefix:  token[:shownPrefix],
		Scope:   scope,
		Created: r.GetDateTime("created").String(),
	}, token, nil
}

func (s *Service) Delete(id string) error {
	r, err := s.app.FindRecordById(collection, id)
	if err != nil {
		return ErrNotFound
	}
	if err := s.app.Delete(r); err != nil {
		return err
	}
	s.mu.Lock()
	delete(s.touched, id)
	s.mu.Unlock()
	return nil
}

// Authenticate returns the key a token belongs to, or nil when it matches none.
func (s *Service) Authenticate(token string) (*Key, error) {
	if !IsKey(token) {
		return nil, nil
	}
	var key Key
	err := s.app.DB().Select("id", "name", "prefix", "scope", "lastUsedAt", "created").
		From(collection).Where(dbx.HashExp{"keyHash": hash(token)}).One(&key)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.touch(key.ID)
	return &key, nil
}

// touch records when a key was last used, at most once per touchEvery.
func (s *Service) touch(id string) {
	now := time.Now()
	s.mu.Lock()
	if now.Sub(s.touched[id]) < touchEvery {
		s.mu.Unlock()
		return
	}
	s.touched[id] = now
	s.mu.Unlock()

	// A direct update: saving the record would also bump "updated" and run record hooks.
	_, err := s.app.DB().Update(collection,
		dbx.Params{"lastUsedAt": now.UTC().Format("2006-01-02 15:04:05.000Z")},
		dbx.HashExp{"id": id}).Execute()
	if err != nil {
		s.app.Logger().Warn("Failed to record API key use", "keyId", id, "error", err)
	}
}
