package fio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestBuildRunReport_ComputesSummaryAndCollectsErrors(t *testing.T) {
	t.Parallel()

	store, err := NewRunStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewRunStore() error = %v", err)
	}

	const runID = "run-report"
	if _, err := store.EnsureRunDir(runID); err != nil {
		t.Fatalf("EnsureRunDir() error = %v", err)
	}

	if err := store.SaveMeta(runID, &RunMeta{
		ID:        runID,
		Status:    "error",
		StartTime: "2026-03-26T12:00:00Z",
		Error:     "fio crashed",
	}); err != nil {
		t.Fatalf("SaveMeta() error = %v", err)
	}

	if err := store.SaveConfig(runID, &RunConfig{
		TaskList: &FioTaskList{
			Tasks: []FioTask{{
				Name:   "stage-1",
				Global: DefaultGlobalConfig(),
				Jobs: []JobConfig{{
					Name:     "job-1",
					Filename: "/tmp/fio-test",
					RW:       RWRandRead,
					BS:       "4k",
					Size:     "1G",
					NumJobs:  1,
					IODepth:  32,
				}},
			}},
		},
	}); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	points := []StatsDataPoint{
		{Time: 1_000, IOPS: 12000, BW: 512, LatMean: 0.4, LatP95: 0.8, LatP99: 1.2, LatMax: 2.0},
		{Time: 1_120, IOPS: 18000, BW: 1536, LatMean: 0.6, LatP95: 1.1, LatP99: 1.8, LatMax: 3.2},
	}
	statsFile := filepath.Join(store.RunDir(runID), "stats.jsonl")
	var payload []byte
	for _, point := range points {
		line, err := json.Marshal(point)
		if err != nil {
			t.Fatalf("json.Marshal() error = %v", err)
		}
		payload = append(payload, line...)
		payload = append(payload, '\n')
	}
	if err := os.WriteFile(statsFile, payload, 0644); err != nil {
		t.Fatalf("WriteFile(stats) error = %v", err)
	}

	if err := os.WriteFile(
		filepath.Join(store.RunDir(runID), "output.log"),
		[]byte("warning line\nfatal: device disappeared\n"),
		0644,
	); err != nil {
		t.Fatalf("WriteFile(output) error = %v", err)
	}

	report, err := store.BuildRunReport(runID, &ReportViewConfig{Metric: "bw", TimeRange: "15m"})
	if err != nil {
		t.Fatalf("BuildRunReport() error = %v", err)
	}

	if report.View == nil || report.View.Metric != "bw" || report.View.TimeRange != "15m" {
		t.Fatalf("unexpected report view: %#v", report.View)
	}
	if report.Summary == nil {
		t.Fatal("report.Summary = nil, want non-nil")
	}
	if report.Summary.SampleCount != 2 {
		t.Fatalf("SampleCount = %d, want 2", report.Summary.SampleCount)
	}
	if report.Summary.DurationSeconds != 120 {
		t.Fatalf("DurationSeconds = %d, want 120", report.Summary.DurationSeconds)
	}
	if report.Summary.PeakIOPS != 18000 {
		t.Fatalf("PeakIOPS = %v, want 18000", report.Summary.PeakIOPS)
	}
	if report.Summary.PeakBandwidthMiB != 1536 {
		t.Fatalf("PeakBandwidthMiB = %v, want 1536", report.Summary.PeakBandwidthMiB)
	}
	if report.Summary.PeakLatencyMs != 3.2 {
		t.Fatalf("PeakLatencyMs = %v, want 3.2", report.Summary.PeakLatencyMs)
	}
	if !slices.Contains(report.Errors, "fio crashed") || !slices.Contains(report.Errors, "fatal: device disappeared") {
		t.Fatalf("Errors = %#v, want merged meta and log errors", report.Errors)
	}
}
