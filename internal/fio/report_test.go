package fio

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
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
		t.Fatalf("DurationSeconds = %v, want 120", report.Summary.DurationSeconds)
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
	if report.Source.Kind != "stats-jsonl-fallback" {
		t.Fatalf("Source.Kind = %q, want stats-jsonl-fallback", report.Source.Kind)
	}
	if !slices.Contains(report.Errors, "fio crashed") || !slices.Contains(report.Errors, "fatal: device disappeared") {
		t.Fatalf("Errors = %#v, want merged meta and log errors", report.Errors)
	}
}

func histogramLogLine(timestamp int64) string {
	buckets := make([]string, 1856)
	for index := range buckets {
		buckets[index] = "0"
	}
	buckets[100] = "99"
	buckets[200] = "1"
	return fmt.Sprintf("%d, 0, 4096, %s\n", timestamp, strings.Join(buckets, ", "))
}

func TestBuildRunReport_UsesTaskLogsAndMarksStageBoundaries(t *testing.T) {
	t.Parallel()

	store, err := NewRunStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewRunStore() error = %v", err)
	}
	const runID = "task-log-report"
	if _, err := store.EnsureRunDir(runID); err != nil {
		t.Fatalf("EnsureRunDir() error = %v", err)
	}
	if err := store.SaveMeta(runID, &RunMeta{ID: runID, Status: "finished", StartTime: "2026-08-04T08:00:00Z"}); err != nil {
		t.Fatalf("SaveMeta() error = %v", err)
	}
	global := DefaultGlobalConfig()
	global.Runtime = 1
	global.LogAvgMsec = 500
	if err := store.SaveConfig(runID, &RunConfig{TaskList: &FioTaskList{Tasks: []FioTask{
		{Name: "预热", Global: global, Jobs: []JobConfig{{Name: "reader"}, {Name: "writer"}}},
		{Name: "测量", Global: global, Jobs: []JobConfig{{Name: "reader"}}},
	}}}); err != nil {
		t.Fatalf("SaveConfig() error = %v", err)
	}

	files := map[string]string{
		"task0_iops.log":      "500, 100, 0, 4096, 0\n500, 50, 1, 4096, 0\n1000, 120, 0, 4096, 0\n1000, 60, 1, 4096, 0\n",
		"task0_bw.log":        "500, 1024, 0, 4096, 0\n500, 2048, 1, 4096, 0\n1000, 2048, 0, 4096, 0\n1000, 1024, 1, 4096, 0\n",
		"task0_clat_hist.log": histogramLogLine(500) + histogramLogLine(1000),
		"task1_iops.log":      "500, 200, 0, 4096, 0\n1000, 220, 0, 4096, 0\n",
		"task1_bw.log":        "500, 4096, 0, 4096, 0\n1000, 5120, 0, 4096, 0\n",
		"task1_clat_hist.log": histogramLogLine(500) + histogramLogLine(1000),
	}
	for name, contents := range files {
		if err := os.WriteFile(filepath.Join(store.RunDir(runID), name), []byte(contents), 0644); err != nil {
			t.Fatalf("WriteFile(%s) error = %v", name, err)
		}
	}

	report, err := store.BuildRunReport(runID, nil)
	if err != nil {
		t.Fatalf("BuildRunReport() error = %v", err)
	}
	if report.Source.Kind != "fio-task-logs" || report.Source.LatencyMode != "histogram" {
		t.Fatalf("unexpected source: %#v", report.Source)
	}
	if len(report.Stages) != 2 || report.Stages[1].StartSeconds != 1 {
		t.Fatalf("unexpected stage boundaries: %#v", report.Stages)
	}
	if len(report.Series) != 4 || report.Series[2].Time != 1.5 {
		t.Fatalf("unexpected series timeline: %#v", report.Series)
	}
	if report.Series[0].IOPS != 150 || report.Series[0].BW != 3 {
		t.Fatalf("first point = %#v, want aggregated IOPS=150 BW=3MiB/s", report.Series[0])
	}
	if report.Series[0].LatMean <= 0 || report.Series[0].LatP99 <= 0 || report.Series[0].LatMax < report.Series[0].LatP99 {
		t.Fatalf("unexpected histogram latency stats: %#v", report.Series[0])
	}
	if report.Summary == nil || report.Summary.P99LatencyMs <= 0 || report.Summary.PeakLatencyMs < report.Summary.P99LatencyMs {
		t.Fatalf("unexpected report summary: %#v", report.Summary)
	}
}
