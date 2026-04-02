package fio

import (
	"regexp"
	"testing"
)

func TestNewRunID(t *testing.T) {
	id := NewRunID()
	if id == "" {
		t.Fatal("NewRunID returned empty string")
	}
	// UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
	matched, _ := regexp.MatchString(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, id)
	if !matched {
		t.Errorf("NewRunID format invalid: %s", id)
	}
}

func TestNewRunID_Unique(t *testing.T) {
	seen := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := NewRunID()
		if seen[id] {
			t.Errorf("Duplicate RunID: %s", id)
		}
		seen[id] = true
	}
}
