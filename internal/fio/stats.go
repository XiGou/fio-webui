package fio

import (
	"fmt"
	"strconv"
)

// FioStatsIncrement represents delta statistics between two log file snapshots
type FioStatsIncrement struct {
	Time      int64   `json:"time"`         // milliseconds
	Duration  float64 `json:"duration_sec"` // seconds between snapshots
	IOPS      float64 `json:"iops"`
	IOPSRead  float64 `json:"iops_read"`
	IOPSWrite float64 `json:"iops_write"`
	BW        float64 `json:"bw"`       // KiB/sec
	BWRead    float64 `json:"bw_read"`  // KiB/sec
	BWWrite   float64 `json:"bw_write"` // KiB/sec
	LatMean   float64 `json:"lat_mean"` // microseconds
	LatP99    float64 `json:"lat_p99"`  // microseconds
	LatP99_9  float64 `json:"lat_p99_9"`
}

// StatsDataPoint is the aggregated metrics structure used by the frontend charts.
// Units are chosen to match the TypeScript StatsDataPoint interface:
// - time: unix timestamp (seconds)
// - IOPS*: raw IOPS
// - BW*: MB/s
// - Lat*: milliseconds
type StatsDataPoint struct {
	Time         int64               `json:"time"`
	StageIndex   int                 `json:"stageIndex"`
	IOPS         float64             `json:"iops"`
	IOPSRead     float64             `json:"iopsRead"`
	IOPSWrite    float64             `json:"iopsWrite"`
	BW           float64             `json:"bw"`      // MiB/s
	BWRead       float64             `json:"bwRead"`  // MiB/s
	BWWrite      float64             `json:"bwWrite"` // MiB/s
	LatMean      float64             `json:"latMean"` // ms
	LatP95       float64             `json:"latP95"`  // ms
	LatP99       float64             `json:"latP99"`  // ms
	LatMax       float64             `json:"latMax"`  // ms
	LatMeanRead  float64             `json:"latMeanRead"`
	LatP95Read   float64             `json:"latP95Read"`
	LatP99Read   float64             `json:"latP99Read"`
	LatMaxRead   float64             `json:"latMaxRead"`
	LatMeanWrite float64             `json:"latMeanWrite"`
	LatP95Write  float64             `json:"latP95Write"`
	LatP99Write  float64             `json:"latP99Write"`
	LatMaxWrite  float64             `json:"latMaxWrite"`
	Jobs         []JobStatsDataPoint `json:"jobs,omitempty"`
}

// JobStatsDataPoint keeps one configured fio job identifiable through live,
// persisted, and report data. numjobs clones are aggregated under the same name.
type JobStatsDataPoint struct {
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	StageIndex   int     `json:"stageIndex"`
	IOPS         float64 `json:"iops"`
	IOPSRead     float64 `json:"iopsRead"`
	IOPSWrite    float64 `json:"iopsWrite"`
	BW           float64 `json:"bw"`
	BWRead       float64 `json:"bwRead"`
	BWWrite      float64 `json:"bwWrite"`
	LatMean      float64 `json:"latMean"`
	LatP95       float64 `json:"latP95"`
	LatP99       float64 `json:"latP99"`
	LatMax       float64 `json:"latMax"`
	LatMeanRead  float64 `json:"latMeanRead"`
	LatP95Read   float64 `json:"latP95Read"`
	LatP99Read   float64 `json:"latP99Read"`
	LatMaxRead   float64 `json:"latMaxRead"`
	LatMeanWrite float64 `json:"latMeanWrite"`
	LatP95Write  float64 `json:"latP95Write"`
	LatP99Write  float64 `json:"latP99Write"`
	LatMaxWrite  float64 `json:"latMaxWrite"`
}

// NormalizeStatsTimeline preserves sample order when fio restarts its local
// elapsed clock for a later task in the same run.
func NormalizeStatsTimeline(points []StatsDataPoint) []StatsDataPoint {
	if len(points) == 0 {
		return nil
	}
	normalized := make([]StatsDataPoint, len(points))
	copy(normalized, points)

	previousRaw := points[0].Time
	lastTime := previousRaw
	sampleStep := int64(0)
	for i := 1; i < len(points); i++ {
		raw := points[i].Time
		delta := raw - previousRaw
		if delta > 0 {
			lastTime += delta
			if sampleStep == 0 || delta < sampleStep {
				sampleStep = delta
			}
		} else if delta < 0 {
			if sampleStep <= 0 {
				sampleStep = 1
			}
			lastTime += sampleStep
		}
		normalized[i].Time = lastTime
		previousRaw = raw
	}
	return normalized
}

type latencySummary struct {
	mean float64
	p95  float64
	p99  float64
	max  float64
}

func latencyFromIO(stats IOStats) (latencySummary, bool) {
	latNs := stats.LatencyNs
	if len(latNs) == 0 && len(stats.LatencyUs) > 0 {
		latNs = make([]Latency, len(stats.LatencyUs))
		for index, latency := range stats.LatencyUs {
			latNs[index] = Latency{Percentile: latency.Percentile, Value: latency.Value * 1000}
		}
	}
	if len(latNs) == 0 && stats.ClatNs != nil {
		for key, value := range stats.ClatNs.Percentile {
			percentile, err := strconv.ParseFloat(key, 64)
			if err != nil || percentile < 0 || percentile > 100 {
				continue
			}
			latNs = append(latNs, Latency{Percentile: uint32(percentile), Value: value})
		}
	}
	if len(latNs) == 0 && (stats.ClatNs == nil || stats.ClatNs.Mean <= 0) {
		return latencySummary{}, false
	}

	summary := latencySummary{}
	if stats.ClatNs != nil && stats.ClatNs.Mean > 0 {
		summary.mean = stats.ClatNs.Mean / 1_000_000
	}
	for _, latency := range latNs {
		valueMs := float64(latency.Value) / 1_000_000
		switch latency.Percentile {
		case 95:
			summary.p95 = valueMs
		case 99:
			summary.p99 = valueMs
		case 100:
			summary.max = valueMs
		}
		if summary.mean == 0 && latency.Percentile <= 50 {
			summary.mean = valueMs
		}
		if valueMs > summary.max {
			summary.max = valueMs
		}
	}
	return summary, true
}

type jobStatsAccumulator struct {
	point      JobStatsDataPoint
	readLat    latencySummary
	writeLat   latencySummary
	readCount  int
	writeCount int
}

func addLatency(target *latencySummary, count *int, source latencySummary, ok bool) {
	if !ok {
		return
	}
	target.mean += source.mean
	target.p95 += source.p95
	target.p99 += source.p99
	if source.max > target.max {
		target.max = source.max
	}
	*count++
}

func averageLatency(value latencySummary, count int) latencySummary {
	if count <= 0 {
		return latencySummary{}
	}
	divisor := float64(count)
	value.mean /= divisor
	value.p95 /= divisor
	value.p99 /= divisor
	return value
}

func applyDirectionalLatency(point *JobStatsDataPoint, read, write latencySummary, readCount, writeCount int) {
	read = averageLatency(read, readCount)
	write = averageLatency(write, writeCount)
	point.LatMeanRead, point.LatP95Read, point.LatP99Read, point.LatMaxRead = read.mean, read.p95, read.p99, read.max
	point.LatMeanWrite, point.LatP95Write, point.LatP99Write, point.LatMaxWrite = write.mean, write.p95, write.p99, write.max

	directionCount := 0.0
	if readCount > 0 {
		point.LatMean += read.mean
		point.LatP95 += read.p95
		point.LatP99 += read.p99
		directionCount++
	}
	if writeCount > 0 {
		point.LatMean += write.mean
		point.LatP95 += write.p95
		point.LatP99 += write.p99
		directionCount++
	}
	if directionCount > 0 {
		point.LatMean /= directionCount
		point.LatP95 /= directionCount
		point.LatP99 /= directionCount
	}
	if read.max > write.max {
		point.LatMax = read.max
	} else {
		point.LatMax = write.max
	}
}

// StatusToStatsDataPoint preserves per-job metrics while retaining aggregate
// fields for summaries and compatibility with older clients.
func StatusToStatsDataPoint(status *StatusUpdate) *StatsDataPoint {
	if status == nil || len(status.Jobs) == 0 {
		return nil
	}

	orderedNames := make([]string, 0, len(status.Jobs))
	accumulators := make(map[string]*jobStatsAccumulator, len(status.Jobs))
	for _, job := range status.Jobs {
		name := job.JobName
		if name == "" {
			name = "fio"
		}
		accumulator := accumulators[name]
		if accumulator == nil {
			accumulator = &jobStatsAccumulator{point: JobStatsDataPoint{Name: name}}
			accumulators[name] = accumulator
			orderedNames = append(orderedNames, name)
		}
		accumulator.point.IOPSRead += job.Read.IOPS
		accumulator.point.IOPSWrite += job.Write.IOPS
		accumulator.point.BWRead += float64(job.Read.BW) / (1024 * 1024)
		accumulator.point.BWWrite += float64(job.Write.BW) / (1024 * 1024)
		readLatency, hasReadLatency := latencyFromIO(job.Read)
		writeLatency, hasWriteLatency := latencyFromIO(job.Write)
		addLatency(&accumulator.readLat, &accumulator.readCount, readLatency, hasReadLatency)
		addLatency(&accumulator.writeLat, &accumulator.writeCount, writeLatency, hasWriteLatency)
	}

	t := status.Time
	if t < 1e9 && t >= 1000 {
		t /= 1000
	}

	point := &StatsDataPoint{Time: t, Jobs: make([]JobStatsDataPoint, 0, len(orderedNames))}
	var aggregateReadLatency, aggregateWriteLatency latencySummary
	aggregateReadCount, aggregateWriteCount := 0, 0
	for _, name := range orderedNames {
		accumulator := accumulators[name]
		accumulator.point.IOPS = accumulator.point.IOPSRead + accumulator.point.IOPSWrite
		accumulator.point.BW = accumulator.point.BWRead + accumulator.point.BWWrite
		applyDirectionalLatency(&accumulator.point, accumulator.readLat, accumulator.writeLat, accumulator.readCount, accumulator.writeCount)
		point.Jobs = append(point.Jobs, accumulator.point)
		point.IOPSRead += accumulator.point.IOPSRead
		point.IOPSWrite += accumulator.point.IOPSWrite
		point.BWRead += accumulator.point.BWRead
		point.BWWrite += accumulator.point.BWWrite
		addLatency(&aggregateReadLatency, &aggregateReadCount, averageLatency(accumulator.readLat, accumulator.readCount), accumulator.readCount > 0)
		addLatency(&aggregateWriteLatency, &aggregateWriteCount, averageLatency(accumulator.writeLat, accumulator.writeCount), accumulator.writeCount > 0)
	}
	point.IOPS = point.IOPSRead + point.IOPSWrite
	point.BW = point.BWRead + point.BWWrite
	aggregate := JobStatsDataPoint{}
	applyDirectionalLatency(&aggregate, aggregateReadLatency, aggregateWriteLatency, aggregateReadCount, aggregateWriteCount)
	point.LatMean, point.LatP95, point.LatP99, point.LatMax = aggregate.LatMean, aggregate.LatP95, aggregate.LatP99, aggregate.LatMax
	point.LatMeanRead, point.LatP95Read, point.LatP99Read, point.LatMaxRead = aggregate.LatMeanRead, aggregate.LatP95Read, aggregate.LatP99Read, aggregate.LatMaxRead
	point.LatMeanWrite, point.LatP95Write, point.LatP99Write, point.LatMaxWrite = aggregate.LatMeanWrite, aggregate.LatP95Write, aggregate.LatP99Write, aggregate.LatMaxWrite
	return point
}

// AssignStatsStage attaches a stable stage/job identity after the executor has
// converted fio's stage-local status update.
func AssignStatsStage(point *StatsDataPoint, stageIndex int) *StatsDataPoint {
	if point == nil {
		return nil
	}
	point.StageIndex = stageIndex
	for index := range point.Jobs {
		point.Jobs[index].StageIndex = stageIndex
		point.Jobs[index].Key = fmt.Sprintf("%d:%s", stageIndex, point.Jobs[index].Name)
	}
	return point
}

// FilterStatsPoints filters points by [from,to] unix-second range and optional limit.
// A zero from/to means unbounded on that side. limit<=0 means no limit.
// When limit is set and exceeded, it keeps the newest N points.
func FilterStatsPoints(points []StatsDataPoint, from, to int64, limit int) []StatsDataPoint {
	if len(points) == 0 {
		return nil
	}
	filtered := make([]StatsDataPoint, 0, len(points))
	for _, p := range points {
		if from > 0 && p.Time < from {
			continue
		}
		if to > 0 && p.Time > to {
			continue
		}
		filtered = append(filtered, p)
	}
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[len(filtered)-limit:]
	}
	return filtered
}
