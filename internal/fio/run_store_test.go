package fio

import (
	"encoding/json"
	"testing"
)

func TestRunStoreGetStatsPreservesSamplesAcrossTaskReset(t *testing.T) {
	store, err := NewRunStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	const runID = "task-reset"
	if _, err := store.EnsureRunDir(runID); err != nil {
		t.Fatal(err)
	}

	for _, point := range []StatsDataPoint{{Time: 1}, {Time: 2}, {Time: 3}, {Time: 1}, {Time: 2}, {Time: 3}} {
		line, err := json.Marshal(point)
		if err != nil {
			t.Fatal(err)
		}
		if err := store.AppendStatsLine(runID, line); err != nil {
			t.Fatal(err)
		}
	}

	points, err := store.GetStats(runID)
	if err != nil {
		t.Fatal(err)
	}
	if len(points) != 6 {
		t.Fatalf("expected all 6 samples, got %d", len(points))
	}
	for i, point := range points {
		want := int64(i + 1)
		if point.Time != want {
			t.Fatalf("point %d time = %d, want %d", i, point.Time, want)
		}
	}
}
