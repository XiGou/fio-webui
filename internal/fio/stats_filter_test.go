package fio

import "testing"

func TestFilterStatsPoints_ByTimeRange(t *testing.T) {
	points := []StatsDataPoint{{Time: 100}, {Time: 120}, {Time: 180}, {Time: 240}}
	filtered := FilterStatsPoints(points, 121, 239, 0)
	if len(filtered) != 1 || filtered[0].Time != 180 {
		t.Fatalf("unexpected filtered points: %+v", filtered)
	}
}

func TestFilterStatsPoints_LimitKeepsNewest(t *testing.T) {
	points := []StatsDataPoint{{Time: 1}, {Time: 2}, {Time: 3}, {Time: 4}}
	filtered := FilterStatsPoints(points, 0, 0, 2)
	if len(filtered) != 2 {
		t.Fatalf("expected 2 points, got %d", len(filtered))
	}
	if filtered[0].Time != 3 || filtered[1].Time != 4 {
		t.Fatalf("expected newest points [3,4], got %+v", filtered)
	}
}
