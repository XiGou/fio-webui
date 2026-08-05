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
	Time       float64 `json:"time"`
	StageIndex int     `json:"stage_index"`
	IOPS       float64 `json:"iops"`
	IOPSRead   float64 `json:"iopsRead"`
	IOPSWrite  float64 `json:"iopsWrite"`
	BW         float64 `json:"bw"`
	BWRead     float64 `json:"bwRead"`
	BWWrite    float64 `json:"bwWrite"`
	LatMean    float64 `json:"latMean"`
	LatP99     float64 `json:"latP99"`
	LatMax     float64 `json:"latMax"`
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
	Stages             []ReportStageBoundary
	Source             ReportDataSource
	AggregateHistogram []uint64
}

type reportPointAccumulator struct {
	point         ReportSeriesPoint
	hasThroughput bool
	latencyValues []float64
	histogram     []uint64
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
		accumulator := ensureReportAccumulator(points, normalizeLogTimestamp(timestamp, interval))
		bucketCount := len(columns) - 3
		if len(accumulator.histogram) == 0 {
			accumulator.histogram = make([]uint64, bucketCount)
		}
		if len(accumulator.histogram) != bucketCount {
			continue
		}
		for index, raw := range columns[3:] {
			count, err := strconv.ParseUint(strings.TrimSpace(raw), 10, 64)
			if err == nil {
				accumulator.histogram[index] += count
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
		prefix := fmt.Sprintf("task%d", stageIndex)
		metricFiles := []struct {
			suffix string
			apply  func(*reportPointAccumulator, float64, int)
		}{
			{suffix: "_iops.log", apply: func(point *reportPointAccumulator, value float64, direction int) {
				point.hasThroughput = true
				point.point.IOPS += value
				if direction == 0 {
					point.point.IOPSRead += value
				} else if direction == 1 {
					point.point.IOPSWrite += value
				}
			}},
			{suffix: "_bw.log", apply: func(point *reportPointAccumulator, value float64, direction int) {
				point.hasThroughput = true
				value /= 1024
				point.point.BW += value
				if direction == 0 {
					point.point.BWRead += value
				} else if direction == 1 {
					point.point.BWWrite += value
				}
			}},
			{suffix: "_lat.log", apply: func(point *reportPointAccumulator, value float64, _ int) {
				point.latencyValues = append(point.latencyValues, value/1_000_000)
			}},
		}

		for _, metricFile := range metricFiles {
			path := filepath.Join(runDir, prefix+metricFile.suffix)
			found, err := parseWindowedMetricLog(path, interval, points, metricFile.apply)
			if err != nil {
				return nil, fmt.Errorf("parse %s: %w", filepath.Base(path), err)
			}
			if found {
				report.Source.Files = append(report.Source.Files, filepath.Base(path))
			}
		}

		histogramPath := filepath.Join(runDir, prefix+"_clat_hist.log")
		foundHistogram, err := parseHistogramLog(histogramPath, interval, points)
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", filepath.Base(histogramPath), err)
		}
		if foundHistogram {
			hasHistogram = true
			report.Source.Files = append(report.Source.Files, filepath.Base(histogramPath))
		}

		timestamps := make([]int64, 0, len(points))
		for timestamp := range points {
			timestamps = append(timestamps, timestamp)
		}
		sort.Slice(timestamps, func(left, right int) bool { return timestamps[left] < timestamps[right] })

		stageDurationMs := int64(0)
		for _, timestamp := range timestamps {
			accumulator := points[timestamp]
			if timestamp > stageDurationMs {
				stageDurationMs = timestamp
			}
			if !accumulator.hasThroughput {
				continue
			}
			accumulator.point.StageIndex = stageIndex
			accumulator.point.Time = float64(elapsedMs+timestamp) / 1000
			if len(accumulator.histogram) > 0 {
				accumulator.point.LatMean, accumulator.point.LatP99, accumulator.point.LatMax = summarizeHistogram(accumulator.histogram)
				report.AggregateHistogram = mergeHistogram(report.AggregateHistogram, accumulator.histogram)
			} else if len(accumulator.latencyValues) > 0 {
				usedLatencyFallback = true
				for _, value := range accumulator.latencyValues {
					accumulator.point.LatMean += value
					if value > accumulator.point.LatMax {
						accumulator.point.LatMax = value
					}
				}
				accumulator.point.LatMean /= float64(len(accumulator.latencyValues))
				accumulator.point.LatP99 = percentile(accumulator.latencyValues, 0.99)
			}
			report.Points = append(report.Points, accumulator.point)
		}
		if stageDurationMs == 0 && task.Global.Runtime > 0 {
			stageDurationMs = int64(task.Global.Runtime) * 1000
		}
		stageName := task.Name
		if strings.TrimSpace(stageName) == "" {
			stageName = fmt.Sprintf("节点 %d", stageIndex+1)
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

	if hasHistogram && usedLatencyFallback {
		report.Source.LatencyMode = "histogram+window-fallback"
	} else if hasHistogram {
		report.Source.LatencyMode = "histogram"
	} else if usedLatencyFallback {
		report.Source.LatencyMode = "window-log-fallback"
	}
	return report, nil
}
