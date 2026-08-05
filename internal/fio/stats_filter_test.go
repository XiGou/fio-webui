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

func TestNormalizeStatsTimeline_PreservesSamplesAcrossTaskReset(t *testing.T) {
	points := []StatsDataPoint{{Time: 1}, {Time: 2}, {Time: 3}, {Time: 1}, {Time: 2}, {Time: 3}}
	normalized := NormalizeStatsTimeline(points)

	want := []int64{1, 2, 3, 4, 5, 6}
	if len(normalized) != len(want) {
		t.Fatalf("expected %d points, got %d", len(want), len(normalized))
	}
	for i, point := range normalized {
		if point.Time != want[i] {
			t.Fatalf("point %d time = %d, want %d", i, point.Time, want[i])
		}
	}
}

func TestNormalizeStatsTimeline_PreservesDuplicateSamples(t *testing.T) {
	points := []StatsDataPoint{{Time: 1}, {Time: 2}, {Time: 2}, {Time: 3}}
	normalized := NormalizeStatsTimeline(points)

	want := []int64{1, 2, 2, 3}
	for i, point := range normalized {
		if point.Time != want[i] {
			t.Fatalf("point %d time = %d, want %d", i, point.Time, want[i])
		}
	}
}
