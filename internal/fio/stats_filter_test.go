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

func TestStatusToStatsDataPoint_PreservesJobsAndDirectionalLatency(t *testing.T) {
	status := &StatusUpdate{Time: 5, Jobs: []JobStatus{
		{
			JobName: "reader",
			Read: IOStats{IOPS: 1200, BW: 8 * 1024 * 1024, ClatNs: &FioClatNs{
				Mean:       250_000,
				Percentile: map[string]uint64{"95.000000": 500_000, "99.000000": 900_000, "100.000000": 1_200_000},
			}},
		},
		{
			JobName: "writer",
			Write: IOStats{IOPS: 600, BW: 4 * 1024 * 1024, ClatNs: &FioClatNs{
				Mean:       750_000,
				Percentile: map[string]uint64{"95.000000": 1_000_000, "99.000000": 1_800_000, "100.000000": 2_400_000},
			}},
		},
	}}

	point := AssignStatsStage(StatusToStatsDataPoint(status), 2)
	if point == nil || len(point.Jobs) != 2 {
		t.Fatalf("unexpected point: %#v", point)
	}
	if point.Jobs[0].Key != "2:reader" || point.Jobs[1].Key != "2:writer" {
		t.Fatalf("unexpected job keys: %#v", point.Jobs)
	}
	if point.IOPSRead != 1200 || point.IOPSWrite != 600 || point.BWRead != 8 || point.BWWrite != 4 {
		t.Fatalf("unexpected directional throughput: %#v", point)
	}
	if point.LatP99Read != 0.9 || point.LatP99Write != 1.8 || point.LatMax != 2.4 {
		t.Fatalf("unexpected directional latency: %#v", point)
	}
}
