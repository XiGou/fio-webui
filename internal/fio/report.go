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
	JobSeries  []ReportJobSeries     `json:"job_series"`
	Stages     []ReportStageBoundary `json:"stages"`
	Source     ReportDataSource      `json:"source"`
	Summary    *ReportSummary        `json:"summary,omitempty"`
	LogSummary *LogSummary           `json:"log_summary"`
	Errors     []string              `json:"errors"`
	View       *ReportViewConfig     `json:"view,omitempty"`
	ExportedAt string                `json:"exported_at"`
}

type ReportSummary struct {
	SampleCount           int     `json:"sample_count"`
	DurationSeconds       float64 `json:"duration_seconds"`
	MeanIOPS              float64 `json:"mean_iops"`
	PeakIOPS              float64 `json:"peak_iops"`
	MeanIOPSRead          float64 `json:"mean_iops_read"`
	PeakIOPSRead          float64 `json:"peak_iops_read"`
	MeanIOPSWrite         float64 `json:"mean_iops_write"`
	PeakIOPSWrite         float64 `json:"peak_iops_write"`
	MeanBandwidthMiB      float64 `json:"mean_bandwidth_mib"`
	PeakBandwidthMiB      float64 `json:"peak_bandwidth_mib"`
	MeanBandwidthReadMiB  float64 `json:"mean_bandwidth_read_mib"`
	PeakBandwidthReadMiB  float64 `json:"peak_bandwidth_read_mib"`
	MeanBandwidthWriteMiB float64 `json:"mean_bandwidth_write_mib"`
	PeakBandwidthWriteMiB float64 `json:"peak_bandwidth_write_mib"`
	MeanLatencyMs         float64 `json:"mean_latency_ms"`
	P99LatencyMs          float64 `json:"p99_latency_ms"`
	PeakLatencyMs         float64 `json:"peak_latency_ms"`
	MeanLatencyReadMs     float64 `json:"mean_latency_read_ms"`
	P99LatencyReadMs      float64 `json:"p99_latency_read_ms"`
	PeakLatencyReadMs     float64 `json:"peak_latency_read_ms"`
	MeanLatencyWriteMs    float64 `json:"mean_latency_write_ms"`
	P99LatencyWriteMs     float64 `json:"p99_latency_write_ms"`
	PeakLatencyWriteMs    float64 `json:"peak_latency_write_ms"`
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
		logReport.JobSeries = reportJobSeriesFromStats(stats)
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
		JobSeries:  logReport.JobSeries,
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
			LatMeanRead: point.LatMeanRead, LatP99Read: point.LatP99Read, LatMaxRead: point.LatMaxRead,
			LatMeanWrite: point.LatMeanWrite, LatP99Write: point.LatP99Write, LatMaxWrite: point.LatMaxWrite,
		})
	}
	return series
}

func reportJobSeriesFromStats(stats []StatsDataPoint) []ReportJobSeries {
	if len(stats) == 0 {
		return nil
	}
	first := stats[0].Time
	indexByKey := make(map[string]int)
	jobSeries := make([]ReportJobSeries, 0)
	for _, point := range stats {
		for _, job := range point.Jobs {
			index, found := indexByKey[job.Key]
			if !found {
				index = len(jobSeries)
				indexByKey[job.Key] = index
				jobSeries = append(jobSeries, ReportJobSeries{
					Key: job.Key, Name: job.Name, StageIndex: job.StageIndex,
					StageName: fmt.Sprintf("节点 %d", job.StageIndex+1), JobIndex: index,
				})
			}
			jobSeries[index].Points = append(jobSeries[index].Points, ReportSeriesPoint{
				Time: float64(point.Time - first), StageIndex: job.StageIndex,
				IOPS: job.IOPS, IOPSRead: job.IOPSRead, IOPSWrite: job.IOPSWrite,
				BW: job.BW, BWRead: job.BWRead, BWWrite: job.BWWrite,
				LatMean: job.LatMean, LatP99: job.LatP99, LatMax: job.LatMax,
				LatMeanRead: job.LatMeanRead, LatP99Read: job.LatP99Read, LatMaxRead: job.LatMaxRead,
				LatMeanWrite: job.LatMeanWrite, LatP99Write: job.LatP99Write, LatMaxWrite: job.LatMaxWrite,
			})
		}
	}
	for index := range jobSeries {
		jobSeries[index].Summary = summarizeReportSeries(jobSeries[index].Points, nil)
	}
	return jobSeries
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
		summary.MeanIOPSRead += point.IOPSRead
		summary.MeanIOPSWrite += point.IOPSWrite
		summary.MeanBandwidthMiB += point.BW
		summary.MeanBandwidthReadMiB += point.BWRead
		summary.MeanBandwidthWriteMiB += point.BWWrite
		summary.MeanLatencyMs += point.LatMean
		summary.MeanLatencyReadMs += point.LatMeanRead
		summary.MeanLatencyWriteMs += point.LatMeanWrite
		if point.IOPS > summary.PeakIOPS {
			summary.PeakIOPS = point.IOPS
		}
		if point.IOPSRead > summary.PeakIOPSRead {
			summary.PeakIOPSRead = point.IOPSRead
		}
		if point.IOPSWrite > summary.PeakIOPSWrite {
			summary.PeakIOPSWrite = point.IOPSWrite
		}
		if point.BW > summary.PeakBandwidthMiB {
			summary.PeakBandwidthMiB = point.BW
		}
		if point.BWRead > summary.PeakBandwidthReadMiB {
			summary.PeakBandwidthReadMiB = point.BWRead
		}
		if point.BWWrite > summary.PeakBandwidthWriteMiB {
			summary.PeakBandwidthWriteMiB = point.BWWrite
		}
		if point.LatMax > summary.PeakLatencyMs {
			summary.PeakLatencyMs = point.LatMax
		}
		if point.LatP99 > summary.P99LatencyMs {
			summary.P99LatencyMs = point.LatP99
		}
		if point.LatP99Read > summary.P99LatencyReadMs {
			summary.P99LatencyReadMs = point.LatP99Read
		}
		if point.LatMaxRead > summary.PeakLatencyReadMs {
			summary.PeakLatencyReadMs = point.LatMaxRead
		}
		if point.LatP99Write > summary.P99LatencyWriteMs {
			summary.P99LatencyWriteMs = point.LatP99Write
		}
		if point.LatMaxWrite > summary.PeakLatencyWriteMs {
			summary.PeakLatencyWriteMs = point.LatMaxWrite
		}
	}
	n := float64(len(series))
	summary.MeanIOPS /= n
	summary.MeanIOPSRead /= n
	summary.MeanIOPSWrite /= n
	summary.MeanBandwidthMiB /= n
	summary.MeanBandwidthReadMiB /= n
	summary.MeanBandwidthWriteMiB /= n
	summary.MeanLatencyMs /= n
	summary.MeanLatencyReadMs /= n
	summary.MeanLatencyWriteMs /= n
	if len(aggregateHistogram) > 0 {
		summary.MeanLatencyMs, summary.P99LatencyMs, summary.PeakLatencyMs = summarizeHistogram(aggregateHistogram)
	}

	return summary
}
