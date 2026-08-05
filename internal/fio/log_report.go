package fio

import (
	"bufio"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type ReportSeriesPoint struct {
	Time         float64 `json:"time"`
	StageIndex   int     `json:"stage_index"`
	IOPS         float64 `json:"iops"`
	IOPSRead     float64 `json:"iopsRead"`
	IOPSWrite    float64 `json:"iopsWrite"`
	BW           float64 `json:"bw"`
	BWRead       float64 `json:"bwRead"`
	BWWrite      float64 `json:"bwWrite"`
	LatMean      float64 `json:"latMean"`
	LatP99       float64 `json:"latP99"`
	LatMax       float64 `json:"latMax"`
	LatMeanRead  float64 `json:"latMeanRead"`
	LatP99Read   float64 `json:"latP99Read"`
	LatMaxRead   float64 `json:"latMaxRead"`
	LatMeanWrite float64 `json:"latMeanWrite"`
	LatP99Write  float64 `json:"latP99Write"`
	LatMaxWrite  float64 `json:"latMaxWrite"`
}

type ReportJobSeries struct {
	Key        string              `json:"key"`
	Name       string              `json:"name"`
	StageIndex int                 `json:"stage_index"`
	StageName  string              `json:"stage_name"`
	JobIndex   int                 `json:"job_index"`
	Points     []ReportSeriesPoint `json:"points"`
	Summary    *ReportSummary      `json:"summary"`
}

type ReportStageBoundary struct {
	Index        int     `json:"index"`
	Name         string  `json:"name"`
	StartSeconds float64 `json:"start_seconds"`
	EndSeconds   float64 `json:"end_seconds"`
	JobCount     int     `json:"job_count"`
}

type ReportDataSource struct {
	Kind             string   `json:"kind"`
	Files            []string `json:"files"`
	LatencyMode      string   `json:"latency_mode"`
	SampleIntervalMs int      `json:"sample_interval_ms"`
}

type fioLogReport struct {
	Points             []ReportSeriesPoint
	JobSeries          []ReportJobSeries
	Stages             []ReportStageBoundary
	Source             ReportDataSource
	AggregateHistogram []uint64
}

type reportPointAccumulator struct {
	point         ReportSeriesPoint
	hasThroughput bool
	latencyValues [2][]float64
	histogram     [2][]uint64
}

func normalizeLogTimestamp(timestamp, interval int64) int64 {
	if interval <= 1 {
		return timestamp
	}
	return ((timestamp + interval/2) / interval) * interval
}

func ensureReportAccumulator(points map[int64]*reportPointAccumulator, timestamp int64) *reportPointAccumulator {
	point := points[timestamp]
	if point == nil {
		point = &reportPointAccumulator{}
		points[timestamp] = point
	}
	return point
}

func parseWindowedMetricLog(path string, interval int64, points map[int64]*reportPointAccumulator, apply func(*reportPointAccumulator, float64, int)) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		columns := strings.Split(scanner.Text(), ",")
		if len(columns) < 3 {
			continue
		}
		timestamp, err := strconv.ParseInt(strings.TrimSpace(columns[0]), 10, 64)
		if err != nil {
			continue
		}
		value, err := strconv.ParseFloat(strings.TrimSpace(columns[1]), 64)
		if err != nil {
			continue
		}
		direction, err := strconv.Atoi(strings.TrimSpace(columns[2]))
		if err != nil {
			continue
		}
		apply(ensureReportAccumulator(points, normalizeLogTimestamp(timestamp, interval)), value, direction)
	}
	return true, scanner.Err()
}

func parseHistogramLog(path string, interval int64, points map[int64]*reportPointAccumulator) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	buffer := make([]byte, 64*1024)
	scanner.Buffer(buffer, 4*1024*1024)
	for scanner.Scan() {
		columns := strings.Split(scanner.Text(), ",")
		if len(columns) < 4 {
			continue
		}
		timestamp, err := strconv.ParseInt(strings.TrimSpace(columns[0]), 10, 64)
		if err != nil {
			continue
		}
		// Histogram logs use: timestamp, direction, block-size, buckets...
		direction, err := strconv.Atoi(strings.TrimSpace(columns[1]))
		if err != nil || direction < 0 || direction > 1 {
			continue
		}
		accumulator := ensureReportAccumulator(points, normalizeLogTimestamp(timestamp, interval))
		bucketCount := len(columns) - 3
		if len(accumulator.histogram[direction]) == 0 {
			accumulator.histogram[direction] = make([]uint64, bucketCount)
		}
		if len(accumulator.histogram[direction]) != bucketCount {
			continue
		}
		for index, raw := range columns[3:] {
			count, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
			if err == nil {
				accumulator.histogram[direction][index] += count
			}
		}
	}
	return true, scanner.Err()
}

func histogramRanges(bucketCount int) [][2]float64 {
	if bucketCount <= 0 {
		return nil
	}
	groupCount := 1
	logicalBucketsPerGroup := bucketCount
	outputBucketsPerGroup := bucketCount
	if bucketCount%64 == 0 {
		groupCount = bucketCount / 64
		logicalBucketsPerGroup = 64
		outputBucketsPerGroup = 64
	} else if bucketCount%29 == 0 {
		groupCount = 29
		logicalBucketsPerGroup = 64
		outputBucketsPerGroup = bucketCount / groupCount
	}
	coarsenessFactor := logicalBucketsPerGroup / outputBucketsPerGroup
	if coarsenessFactor < 1 {
		coarsenessFactor = 1
	}

	ranges := make([][2]float64, 0, bucketCount)
	width := 1.0
	base := 0.0
	for group := 0; group < groupCount; group++ {
		for bucket := 0; bucket < outputBucketsPerGroup; bucket++ {
			upper := base + width*float64(coarsenessFactor)
			ranges = append(ranges, [2]float64{base, upper})
			base = upper
		}
		if group != 0 {
			width *= 2
		}
	}
	return ranges
}

func summarizeHistogram(histogram []uint64) (meanMs, p99Ms, maxMs float64) {
	if len(histogram) == 0 {
		return 0, 0, 0
	}
	ranges := histogramRanges(len(histogram))
	var total uint64
	var weighted float64
	lastNonZero := -1
	for index, count := range histogram {
		if count == 0 {
			continue
		}
		total += count
		weighted += float64(count) * (ranges[index][0] + ranges[index][1]) / 2
		lastNonZero = index
	}
	if total == 0 {
		return 0, 0, 0
	}

	target := float64(total) * 0.99
	var cumulative uint64
	p99Ns := 0.0
	for index, count := range histogram {
		if count == 0 {
			continue
		}
		before := cumulative
		cumulative += count
		if float64(cumulative) >= target {
			fraction := (target - float64(before)) / float64(count)
			fraction = math.Max(0, math.Min(1, fraction))
			p99Ns = ranges[index][0] + fraction*(ranges[index][1]-ranges[index][0])
			break
		}
	}

	meanMs = weighted / float64(total) / 1_000_000
	p99Ms = p99Ns / 1_000_000
	maxMs = ranges[lastNonZero][1] / 1_000_000
	return meanMs, p99Ms, maxMs
}

func percentile(values []float64, quantile float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]float64(nil), values...)
	sort.Float64s(ordered)
	index := int(math.Ceil(float64(len(ordered))*quantile)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(ordered) {
		index = len(ordered) - 1
	}
	return ordered[index]
}

func mergeHistogram(target []uint64, source []uint64) []uint64 {
	if len(source) == 0 {
		return target
	}
	if len(target) == 0 {
		return append([]uint64(nil), source...)
	}
	if len(target) != len(source) {
		return target
	}
	for index, count := range source {
		target[index] += count
	}
	return target
}

func summarizeLatencyValues(values []float64) (mean, p99, max float64) {
	if len(values) == 0 {
		return 0, 0, 0
	}
	for _, value := range values {
		mean += value
		if value > max {
			max = value
		}
	}
	return mean / float64(len(values)), percentile(values, 0.99), max
}

func setDirectionalReportLatency(point *ReportSeriesPoint, direction int, mean, p99, max float64) {
	if direction == 0 {
		point.LatMeanRead, point.LatP99Read, point.LatMaxRead = mean, p99, max
	} else {
		point.LatMeanWrite, point.LatP99Write, point.LatMaxWrite = mean, p99, max
	}
}

func finalizeReportLatency(accumulator *reportPointAccumulator, aggregateHistogram *[]uint64) (hasHistogram, usedFallback bool) {
	combinedHistogram := []uint64(nil)
	directionCount := 0.0
	for direction := 0; direction <= 1; direction++ {
		var mean, p99, max float64
		if len(accumulator.histogram[direction]) > 0 {
			hasHistogram = true
			mean, p99, max = summarizeHistogram(accumulator.histogram[direction])
			combinedHistogram = mergeHistogram(combinedHistogram, accumulator.histogram[direction])
		} else if len(accumulator.latencyValues[direction]) > 0 {
			usedFallback = true
			mean, p99, max = summarizeLatencyValues(accumulator.latencyValues[direction])
		}
		setDirectionalReportLatency(&accumulator.point, direction, mean, p99, max)
		if mean > 0 || p99 > 0 || max > 0 {
			accumulator.point.LatMean += mean
			if p99 > accumulator.point.LatP99 {
				accumulator.point.LatP99 = p99
			}
			if max > accumulator.point.LatMax {
				accumulator.point.LatMax = max
			}
			directionCount++
		}
	}
	if directionCount > 0 {
		accumulator.point.LatMean /= directionCount
	}
	if len(combinedHistogram) > 0 {
		*aggregateHistogram = mergeHistogram(*aggregateHistogram, combinedHistogram)
		if !usedFallback {
			accumulator.point.LatMean, accumulator.point.LatP99, accumulator.point.LatMax = summarizeHistogram(combinedHistogram)
		}
	}
	return hasHistogram, usedFallback
}

func sortedReportTimestamps(points map[int64]*reportPointAccumulator) []int64 {
	timestamps := make([]int64, 0, len(points))
	for timestamp := range points {
		timestamps = append(timestamps, timestamp)
	}
	sort.Slice(timestamps, func(left, right int) bool { return timestamps[left] < timestamps[right] })
	return timestamps
}

func buildReportPoints(points map[int64]*reportPointAccumulator, stageIndex int, elapsedMs int64, aggregateHistogram *[]uint64) (series []ReportSeriesPoint, durationMs int64, hasHistogram, usedFallback bool) {
	for _, timestamp := range sortedReportTimestamps(points) {
		accumulator := points[timestamp]
		if timestamp > durationMs {
			durationMs = timestamp
		}
		if !accumulator.hasThroughput {
			continue
		}
		accumulator.point.StageIndex = stageIndex
		accumulator.point.Time = float64(elapsedMs+timestamp) / 1000
		hasPointHistogram, usedPointFallback := finalizeReportLatency(accumulator, aggregateHistogram)
		hasHistogram = hasHistogram || hasPointHistogram
		usedFallback = usedFallback || usedPointFallback
		series = append(series, accumulator.point)
	}
	return series, durationMs, hasHistogram, usedFallback
}

func reportJobIndexForOrdinal(jobs []JobConfig, ordinal int) (int, bool) {
	if ordinal < 1 {
		return 0, len(jobs) > 0
	}
	nextOrdinal := 1
	for jobIndex, job := range jobs {
		instances := job.NumJobs
		if instances < 1 {
			instances = 1
		}
		if ordinal >= nextOrdinal && ordinal < nextOrdinal+instances {
			return jobIndex, true
		}
		nextOrdinal += instances
	}
	return 0, false
}

func reportLogOrdinal(path string) (int, bool) {
	name := strings.TrimSuffix(filepath.Base(path), ".log")
	segments := strings.Split(name, ".")
	if len(segments) < 2 {
		return 0, false
	}
	ordinal, err := strconv.Atoi(segments[len(segments)-1])
	return ordinal, err == nil
}

func appendSourceFile(source *ReportDataSource, path string) {
	name := filepath.Base(path)
	for _, existing := range source.Files {
		if existing == name {
			return
		}
	}
	source.Files = append(source.Files, name)
}

type reportMetricLog struct {
	suffix string
	apply  func(*reportPointAccumulator, float64, int)
}

func reportMetricLogs() []reportMetricLog {
	return []reportMetricLog{
		{suffix: "_iops", apply: func(point *reportPointAccumulator, value float64, direction int) {
			point.hasThroughput = true
			point.point.IOPS += value
			if direction == 0 {
				point.point.IOPSRead += value
			} else if direction == 1 {
				point.point.IOPSWrite += value
			}
		}},
		{suffix: "_bw", apply: func(point *reportPointAccumulator, value float64, direction int) {
			point.hasThroughput = true
			value /= 1024
			point.point.BW += value
			if direction == 0 {
				point.point.BWRead += value
			} else if direction == 1 {
				point.point.BWWrite += value
			}
		}},
		{suffix: "_lat", apply: func(point *reportPointAccumulator, value float64, direction int) {
			if direction >= 0 && direction <= 1 {
				point.latencyValues[direction] = append(point.latencyValues[direction], value/1_000_000)
			}
		}},
	}
}

func parseAggregateTaskLogs(runDir, prefix string, interval int64, points map[int64]*reportPointAccumulator, source *ReportDataSource) (bool, error) {
	foundAny := false
	for _, metric := range reportMetricLogs() {
		path := filepath.Join(runDir, prefix+metric.suffix+".log")
		found, err := parseWindowedMetricLog(path, interval, points, metric.apply)
		if err != nil {
			return false, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
		}
		if found {
			foundAny = true
			appendSourceFile(source, path)
		}
	}
	histogramPath := filepath.Join(runDir, prefix+"_clat_hist.log")
	found, err := parseHistogramLog(histogramPath, interval, points)
	if err != nil {
		return false, fmt.Errorf("parse %s: %w", filepath.Base(histogramPath), err)
	}
	if found {
		foundAny = true
		appendSourceFile(source, histogramPath)
	}
	return foundAny, nil
}

func parsePerJobTaskLogs(runDir, prefix string, interval int64, jobs []JobConfig, aggregate map[int64]*reportPointAccumulator, perJob []map[int64]*reportPointAccumulator, source *ReportDataSource) (bool, error) {
	iopsPattern := filepath.Join(runDir, prefix+"_iops.*.log")
	iopsFiles, err := filepath.Glob(iopsPattern)
	if err != nil || len(iopsFiles) == 0 {
		return false, err
	}

	parseWindowed := func(path string, points map[int64]*reportPointAccumulator, apply func(*reportPointAccumulator, float64, int)) error {
		_, parseErr := parseWindowedMetricLog(path, interval, points, apply)
		return parseErr
	}
	for _, metric := range reportMetricLogs() {
		paths, globErr := filepath.Glob(filepath.Join(runDir, prefix+metric.suffix+".*.log"))
		if globErr != nil {
			return false, globErr
		}
		sort.Strings(paths)
		for _, path := range paths {
			ordinal, ok := reportLogOrdinal(path)
			if !ok {
				continue
			}
			jobIndex, ok := reportJobIndexForOrdinal(jobs, ordinal)
			if !ok {
				continue
			}
			if err := parseWindowed(path, perJob[jobIndex], metric.apply); err != nil {
				return false, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
			}
			if err := parseWindowed(path, aggregate, metric.apply); err != nil {
				return false, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
			}
			appendSourceFile(source, path)
		}
	}

	histogramPaths, globErr := filepath.Glob(filepath.Join(runDir, prefix+"_clat_hist.*.log"))
	if globErr != nil {
		return false, globErr
	}
	sort.Strings(histogramPaths)
	for _, path := range histogramPaths {
		ordinal, ok := reportLogOrdinal(path)
		if !ok {
			continue
		}
		jobIndex, ok := reportJobIndexForOrdinal(jobs, ordinal)
		if !ok {
			continue
		}
		if _, err := parseHistogramLog(path, interval, perJob[jobIndex]); err != nil {
			return false, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
		}
		if _, err := parseHistogramLog(path, interval, aggregate); err != nil {
			return false, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
		}
		appendSourceFile(source, path)
	}
	return true, nil
}

func (s *RunStore) getFioLogReport(runID string, tasks []FioTask) (*fioLogReport, error) {
	report := &fioLogReport{Source: ReportDataSource{Kind: "fio-task-logs", LatencyMode: "unavailable"}}
	runDir := s.RunDir(runID)
	elapsedMs := int64(0)
	hasHistogram := false
	usedLatencyFallback := false

	for stageIndex, task := range tasks {
		interval := int64(task.Global.LogAvgMsec)
		if interval <= 0 {
			interval = 500
		}
		if report.Source.SampleIntervalMs == 0 || int(interval) < report.Source.SampleIntervalMs {
			report.Source.SampleIntervalMs = int(interval)
		}

		points := make(map[int64]*reportPointAccumulator)
		jobPoints := make([]map[int64]*reportPointAccumulator, len(task.Jobs))
		for jobIndex := range jobPoints {
			jobPoints[jobIndex] = make(map[int64]*reportPointAccumulator)
		}
		prefix := fmt.Sprintf("task%d", stageIndex)
		perJobLogs, err := parsePerJobTaskLogs(runDir, prefix, interval, task.Jobs, points, jobPoints, &report.Source)
		if err != nil {
			return nil, err
		}
		if !perJobLogs {
			if _, err := parseAggregateTaskLogs(runDir, prefix, interval, points, &report.Source); err != nil {
				return nil, err
			}
		}

		stageSeries, stageDurationMs, stageHasHistogram, stageUsedFallback := buildReportPoints(points, stageIndex, elapsedMs, &report.AggregateHistogram)
		report.Points = append(report.Points, stageSeries...)
		hasHistogram = hasHistogram || stageHasHistogram
		usedLatencyFallback = usedLatencyFallback || stageUsedFallback
		if stageDurationMs == 0 && task.Global.Runtime > 0 {
			stageDurationMs = int64(task.Global.Runtime) * 1000
		}
		stageName := task.Name
		if strings.TrimSpace(stageName) == "" {
			stageName = fmt.Sprintf("节点 %d", stageIndex+1)
		}
		if perJobLogs {
			for jobIndex, job := range task.Jobs {
				jobHistogram := []uint64(nil)
				series, _, jobHasHistogram, jobUsedFallback := buildReportPoints(jobPoints[jobIndex], stageIndex, elapsedMs, &jobHistogram)
				if len(series) == 0 {
					continue
				}
				report.JobSeries = append(report.JobSeries, ReportJobSeries{
					Key:        fmt.Sprintf("%d:%s", stageIndex, job.Name),
					Name:       job.Name,
					StageIndex: stageIndex,
					StageName:  stageName,
					JobIndex:   jobIndex,
					Points:     series,
					Summary:    summarizeReportSeries(series, jobHistogram),
				})
				hasHistogram = hasHistogram || jobHasHistogram
				usedLatencyFallback = usedLatencyFallback || jobUsedFallback
			}
		} else if len(task.Jobs) == 1 && len(stageSeries) > 0 {
			report.JobSeries = append(report.JobSeries, ReportJobSeries{
				Key:        fmt.Sprintf("%d:%s", stageIndex, task.Jobs[0].Name),
				Name:       task.Jobs[0].Name,
				StageIndex: stageIndex,
				StageName:  stageName,
				JobIndex:   0,
				Points:     append([]ReportSeriesPoint(nil), stageSeries...),
				Summary:    summarizeReportSeries(stageSeries, nil),
			})
		}
		report.Stages = append(report.Stages, ReportStageBoundary{
			Index:        stageIndex,
			Name:         stageName,
			StartSeconds: float64(elapsedMs) / 1000,
			EndSeconds:   float64(elapsedMs+stageDurationMs) / 1000,
			JobCount:     len(task.Jobs),
		})
		elapsedMs += stageDurationMs
	}
	sort.Strings(report.Source.Files)

	if hasHistogram && usedLatencyFallback {
		report.Source.LatencyMode = "histogram+window-fallback"
	} else if hasHistogram {
		report.Source.LatencyMode = "histogram"
	} else if usedLatencyFallback {
		report.Source.LatencyMode = "window-log-fallback"
	}
	return report, nil
}
