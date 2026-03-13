package fio

import (
	"fmt"
	"time"
)

// ReportViewConfig describes how charts should be rendered in exported reports.
type ReportViewConfig struct {
	Metric    string `json:"metric"`
	TimeRange string `json:"time_range"`
}

// RunReportDTO is a normalized report object that can be consumed directly by frontend/HTML exporters.
type RunReportDTO struct {
	Meta       *RunMeta          `json:"meta"`
	Config     *RunConfig        `json:"config"`
	Stats      []StatsDataPoint  `json:"stats"`
	LogSummary *LogSummary       `json:"log_summary"`
	Errors     []string          `json:"errors"`
	View       *ReportViewConfig `json:"view,omitempty"`
	ExportedAt string            `json:"exported_at"`
}

func (s *RunStore) BuildRunReport(runID string, view *ReportViewConfig) (*RunReportDTO, error) {
	meta, err := s.GetMeta(runID)
	if err != nil {
		return nil, fmt.Errorf("load meta: %w", err)
	}
	runConfig, err := s.GetRunConfig(runID)
	if err != nil {
		return nil, fmt.Errorf("load config: %w", err)
	}
	stats, err := s.GetStats(runID)
	if err != nil {
		return nil, fmt.Errorf("load stats: %w", err)
	}
	logSummary, err := s.GetLogSummary(runID)
	if err != nil {
		return nil, fmt.Errorf("load log summary: %w", err)
	}

	errors := make([]string, 0)
	if meta.Error != "" {
		errors = append(errors, meta.Error)
	}
	if logSummary != nil && len(logSummary.Errors) > 0 {
		errors = append(errors, logSummary.Errors...)
	}

	return &RunReportDTO{
		Meta:       meta,
		Config:     runConfig,
		Stats:      stats,
		LogSummary: logSummary,
		Errors:     errors,
		View:       normalizeReportView(view),
		ExportedAt: time.Now().Format(time.RFC3339),
	}, nil
}

func normalizeReportView(view *ReportViewConfig) *ReportViewConfig {
	if view == nil {
		return &ReportViewConfig{Metric: "iops", TimeRange: "all"}
	}
	out := &ReportViewConfig{Metric: view.Metric, TimeRange: view.TimeRange}
	switch out.Metric {
	case "iops", "bw", "lat":
	default:
		out.Metric = "iops"
	}
	switch out.TimeRange {
	case "all", "15m", "1h", "6h", "24h":
	default:
		out.TimeRange = "all"
	}
	return out
}
