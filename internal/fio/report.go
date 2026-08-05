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
	Meta       *RunMeta              `json:"meta"`
	Config     *RunConfig            `json:"config"`
	Stats      []StatsDataPoint      `json:"stats"`
	Series     []ReportSeriesPoint   `json:"series"`
	Stages     []ReportStageBoundary `json:"stages"`
	Source     ReportDataSource      `json:"source"`
	Summary    *ReportSummary        `json:"summary,omitempty"`
	LogSummary *LogSummary           `json:"log_summary"`
	Errors     []string              `json:"errors"`
	View       *ReportViewConfig     `json:"view,omitempty"`
	ExportedAt string                `json:"exported_at"`
}

type ReportSummary struct {
	SampleCount      int     `json:"sample_count"`
	DurationSeconds  float64 `json:"duration_seconds"`
	MeanIOPS         float64 `json:"mean_iops"`
	PeakIOPS         float64 `json:"peak_iops"`
	MeanBandwidthMiB float64 `json:"mean_bandwidth_mib"`
	PeakBandwidthMiB float64 `json:"peak_bandwidth_mib"`
	MeanLatencyMs    float64 `json:"mean_latency_ms"`
	P99LatencyMs     float64 `json:"p99_latency_ms"`
	PeakLatencyMs    float64 `json:"peak_latency_ms"`
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
	tasks := []FioTask{}
	if runConfig.TaskList != nil {
		tasks = runConfig.TaskList.Tasks
	}
	logReport, err := s.getFioLogReport(runID, tasks)
	if err != nil {
		return nil, fmt.Errorf("load fio task logs: %w", err)
	}
	if len(logReport.Points) == 0 {
		logReport.Points = reportSeriesFromStats(stats)
		logReport.Source = ReportDataSource{Kind: "stats-jsonl-fallback", Files: []string{"stats.jsonl"}, LatencyMode: "status-percentiles"}
	}

	errors := make([]string, 0)
	if meta.Error != "" {
		errors = append(errors, meta.Error)
	}
	if logSummary != nil && len(logSummary.Errors) > 0 {
		errors = append(errors, logSummary.Errors...)
	}
	reportSummary := summarizeReportSeries(logReport.Points, logReport.AggregateHistogram)
	if logReport.Source.Kind == "fio-task-logs" && len(logReport.Stages) > 0 {
		reportSummary.DurationSeconds = logReport.Stages[len(logReport.Stages)-1].EndSeconds
	}

	return &RunReportDTO{
		Meta:       meta,
		Config:     runConfig,
		Stats:      stats,
		Series:     logReport.Points,
		Stages:     logReport.Stages,
		Source:     logReport.Source,
		Summary:    reportSummary,
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

func reportSeriesFromStats(stats []StatsDataPoint) []ReportSeriesPoint {
	if len(stats) == 0 {
		return nil
	}
	first := stats[0].Time
	series := make([]ReportSeriesPoint, 0, len(stats))
	for _, point := range stats {
		series = append(series, ReportSeriesPoint{
			Time: float64(point.Time - first), IOPS: point.IOPS, IOPSRead: point.IOPSRead, IOPSWrite: point.IOPSWrite,
			BW: point.BW, BWRead: point.BWRead, BWWrite: point.BWWrite,
			LatMean: point.LatMean, LatP99: point.LatP99, LatMax: point.LatMax,
		})
	}
	return series
}

func summarizeReportSeries(series []ReportSeriesPoint, aggregateHistogram []uint64) *ReportSummary {
	summary := &ReportSummary{}
	if len(series) == 0 {
		return summary
	}

	summary.SampleCount = len(series)
	summary.DurationSeconds = series[len(series)-1].Time

	for _, point := range series {
		summary.MeanIOPS += point.IOPS
		summary.MeanBandwidthMiB += point.BW
		summary.MeanLatencyMs += point.LatMean
		if point.IOPS > summary.PeakIOPS {
			summary.PeakIOPS = point.IOPS
		}
		if point.BW > summary.PeakBandwidthMiB {
			summary.PeakBandwidthMiB = point.BW
		}
		if point.LatMax > summary.PeakLatencyMs {
			summary.PeakLatencyMs = point.LatMax
		}
		if point.LatP99 > summary.P99LatencyMs {
			summary.P99LatencyMs = point.LatP99
		}
	}
	n := float64(len(series))
	summary.MeanIOPS /= n
	summary.MeanBandwidthMiB /= n
	summary.MeanLatencyMs /= n
	if len(aggregateHistogram) > 0 {
		summary.MeanLatencyMs, summary.P99LatencyMs, summary.PeakLatencyMs = summarizeHistogram(aggregateHistogram)
	}

	return summary
}
