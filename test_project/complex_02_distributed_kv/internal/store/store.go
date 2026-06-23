package store

import (
	"fmt"
	"sync"
	"time"
)

type Entry struct {
	Value     string
	Version   int64
	CreatedAt time.Time
	UpdatedAt time.Time
	TTL       time.Duration
	ExpiresAt time.Time
}

type KVStore struct {
	data    map[string]*Entry
	// BUG 1: No mutex - concurrent access will cause race conditions
	version int64
}

func NewKVStore() *KVStore {
	return &KVStore{
		data: make(map[string]*Entry),
	}
}

func (s *KVStore) Get(key string) (string, int64, error) {
	entry, ok := s.data[key]
	if !ok {
		return "", 0, fmt.Errorf("key not found: %s", key)
	}

	// BUG 2: No TTL expiration check on read
	return entry.Value, entry.Version, nil
}

func (s *KVStore) Set(key, value string) (int64, error) {
	if key == "" {
		return 0, fmt.Errorf("key cannot be empty")
	}
	if len(key) > 256 {
		return 0, fmt.Errorf("key too long: max 256 bytes")
	}
	if len(value) > 1024*1024 {
		return 0, fmt.Errorf("value too large: max 1MB")
	}

	s.version++
	now := time.Now()

	entry, exists := s.data[key]
	if exists {
		entry.Value = value
		entry.Version = s.version
		entry.UpdatedAt = now
	} else {
		s.data[key] = &Entry{
			Value:     value,
			Version:   s.version,
			CreatedAt: now,
			UpdatedAt: now,
		}
	}

	return s.version, nil
}

func (s *KVStore) Delete(key string) error {
	_, ok := s.data[key]
	if !ok {
		return fmt.Errorf("key not found: %s", key)
	}
	delete(s.data, key)
	return nil
}

func (s *KVStore) SetWithTTL(key, value string, ttl time.Duration) (int64, error) {
	ver, err := s.Set(key, value)
	if err != nil {
		return 0, err
	}
	entry := s.data[key]
	entry.TTL = ttl
	entry.ExpiresAt = time.Now().Add(ttl)
	return ver, nil
}

// BUG 3: Keys() is not thread-safe and iterates while others may modify
func (s *KVStore) Keys() []string {
	keys := make([]string, 0, len(s.data))
	for k := range s.data {
		keys = append(keys, k)
	}
	return keys
}

func (s *KVStore) Len() int {
	return len(s.data)
}

// BUG 4: CompareAndSwap doesn't use atomic operations
func (s *KVStore) CompareAndSwap(key string, expectedVersion int64, newValue string) (int64, error) {
	entry, ok := s.data[key]
	if !ok {
		return 0, fmt.Errorf("key not found: %s", key)
	}

	if entry.Version != expectedVersion {
		return 0, fmt.Errorf("version mismatch: expected %d, got %d", expectedVersion, entry.Version)
	}

	s.version++
	entry.Value = newValue
	entry.Version = s.version
	entry.UpdatedAt = time.Now()

	return s.version, nil
}

// Snapshot returns a copy of all data for persistence
func (s *KVStore) Snapshot() map[string]Entry {
	snap := make(map[string]Entry, len(s.data))
	for k, v := range s.data {
		snap[k] = *v
	}
	return snap
}

// Restore loads data from a snapshot
func (s *KVStore) Restore(snap map[string]Entry) {
	s.data = make(map[string]*Entry, len(snap))
	for k, v := range snap {
		v2 := v
		s.data[k] = &v2
	}
}

// Ensure sync import is used (for the fix)
var _ = sync.Mutex{}
