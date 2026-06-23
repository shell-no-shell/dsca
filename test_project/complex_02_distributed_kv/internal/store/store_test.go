package store

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestBasicSetGet(t *testing.T) {
	s := NewKVStore()

	ver, err := s.Set("key1", "value1")
	if err != nil {
		t.Fatalf("Set failed: %v", err)
	}
	if ver != 1 {
		t.Errorf("expected version 1, got %d", ver)
	}

	val, gotVer, err := s.Get("key1")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if val != "value1" {
		t.Errorf("expected value1, got %s", val)
	}
	if gotVer != 1 {
		t.Errorf("expected version 1, got %d", gotVer)
	}
}

func TestGetNotFound(t *testing.T) {
	s := NewKVStore()
	_, _, err := s.Get("nonexistent")
	if err == nil {
		t.Error("expected error for missing key")
	}
}

func TestDelete(t *testing.T) {
	s := NewKVStore()
	s.Set("key1", "value1")

	err := s.Delete("key1")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}

	_, _, err = s.Get("key1")
	if err == nil {
		t.Error("expected error after delete")
	}
}

func TestDeleteNotFound(t *testing.T) {
	s := NewKVStore()
	err := s.Delete("nonexistent")
	if err == nil {
		t.Error("expected error for missing key")
	}
}

func TestSetEmptyKey(t *testing.T) {
	s := NewKVStore()
	_, err := s.Set("", "value")
	if err == nil {
		t.Error("expected error for empty key")
	}
}

func TestSetLongKey(t *testing.T) {
	s := NewKVStore()
	longKey := make([]byte, 300)
	for i := range longKey {
		longKey[i] = 'a'
	}
	_, err := s.Set(string(longKey), "value")
	if err == nil {
		t.Error("expected error for long key")
	}
}

func TestOverwrite(t *testing.T) {
	s := NewKVStore()
	s.Set("key1", "value1")
	ver, _ := s.Set("key1", "value2")

	val, _, _ := s.Get("key1")
	if val != "value2" {
		t.Errorf("expected value2, got %s", val)
	}
	if ver != 2 {
		t.Errorf("expected version 2, got %d", ver)
	}
}

func TestKeys(t *testing.T) {
	s := NewKVStore()
	s.Set("a", "1")
	s.Set("b", "2")
	s.Set("c", "3")

	keys := s.Keys()
	if len(keys) != 3 {
		t.Errorf("expected 3 keys, got %d", len(keys))
	}
}

func TestLen(t *testing.T) {
	s := NewKVStore()
	s.Set("a", "1")
	s.Set("b", "2")

	if s.Len() != 2 {
		t.Errorf("expected 2, got %d", s.Len())
	}
}

func TestCompareAndSwap(t *testing.T) {
	s := NewKVStore()
	ver, _ := s.Set("key1", "value1")

	newVer, err := s.CompareAndSwap("key1", ver, "value2")
	if err != nil {
		t.Fatalf("CAS failed: %v", err)
	}

	val, _, _ := s.Get("key1")
	if val != "value2" {
		t.Errorf("expected value2, got %s", val)
	}
	if newVer <= ver {
		t.Errorf("expected new version > %d, got %d", ver, newVer)
	}
}

func TestCompareAndSwapVersionMismatch(t *testing.T) {
	s := NewKVStore()
	s.Set("key1", "value1")

	_, err := s.CompareAndSwap("key1", 999, "value2")
	if err == nil {
		t.Error("expected version mismatch error")
	}
}

func TestTTLExpiration(t *testing.T) {
	s := NewKVStore()
	s.SetWithTTL("key1", "value1", 50*time.Millisecond)

	// Should be readable immediately
	val, _, err := s.Get("key1")
	if err != nil {
		t.Fatalf("Get failed immediately: %v", err)
	}
	if val != "value1" {
		t.Errorf("expected value1, got %s", val)
	}

	// Wait for TTL to expire
	time.Sleep(100 * time.Millisecond)

	// BUG TEST: Should return error after TTL expires, but Get doesn't check TTL
	_, _, err = s.Get("key1")
	if err == nil {
		t.Error("expected error after TTL expiration, but key is still accessible")
	}
}

// RACE CONDITION TESTS - These will fail with -race flag

func TestConcurrentSetGet(t *testing.T) {
	s := NewKVStore()
	var wg sync.WaitGroup

	// Writer goroutines
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				key := fmt.Sprintf("key-%d-%d", id, j)
				s.Set(key, fmt.Sprintf("value-%d-%d", id, j))
			}
		}(i)
	}

	// Reader goroutines
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 100; j++ {
				s.Keys()
			}
		}()
	}

	wg.Wait()

	if s.Len() != 1000 {
		t.Errorf("expected 1000 keys, got %d", s.Len())
	}
}

func TestConcurrentCompareAndSwap(t *testing.T) {
	s := NewKVStore()
	s.Set("counter", "0")

	var wg sync.WaitGroup
	successCount := 0
	var mu sync.Mutex

	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for attempt := 0; attempt < 10; attempt++ {
				_, ver, _ := s.Get("counter")
				_, err := s.CompareAndSwap("counter", ver, fmt.Sprintf("%d", ver+1))
				if err == nil {
					mu.Lock()
					successCount++
					mu.Unlock()
					return
				}
			}
		}()
	}

	wg.Wait()

	// At least some CAS operations should succeed
	if successCount == 0 {
		t.Error("no CAS operations succeeded")
	}
}

func TestSnapshotRestore(t *testing.T) {
	s := NewKVStore()
	s.Set("key1", "value1")
	s.Set("key2", "value2")
	s.Set("key3", "value3")

	snap := s.Snapshot()

	// Create a new store and restore
	s2 := NewKVStore()
	s2.Restore(snap)

	val, _, err := s2.Get("key1")
	if err != nil {
		t.Fatalf("Get failed after restore: %v", err)
	}
	if val != "value1" {
		t.Errorf("expected value1, got %s", val)
	}

	if s2.Len() != 3 {
		t.Errorf("expected 3 keys after restore, got %d", s2.Len())
	}
}
