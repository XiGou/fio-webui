package fio

import "strconv"

// FioStatsIncrement represents delta statistics between two log file snapshots
type FioStatsIncrement struct {
	Time       int64   `json:"time"`         // milliseconds
	Duration   float64 `json:"duration_sec"` // seconds between snapshots
	IOPS       float64 `json:"iops"`
	IOPSRead   float64 `json:"iops_read"`
	IOPSWrite  float64 `json:"iops_write"`
	BW         float64 `json:"bw"`       // KiB/sec
	BWRead     float64 `json:"bw_read"`  // KiB/sec
	BWWrite    float64 `json:"bw_write"` // KiB/sec
	LatMean    float64 `json:"lat_mean"` // microseconds
	LatP99     float64 `json:"lat_p99"`  // microseconds
	LatP99_9   float64 `json:"lat_p99_9"`
}

// StatsDataPoint is the aggregated metrics structure used by the frontend charts.
// Units are chosen to match the TypeScript StatsDataPoint interface:
// - time: unix timestamp (seconds)
// - IOPS*: raw IOPS
// - BW*: MB/s
// - Lat*: milliseconds
type StatsDataPoint struct {
	Time      int64   `json:"time"`
	IOPS      float64 `json:"iops"`
	IOPSRead  float64 `json:"iopsRead"`
	IOPSWrite float64 `json:"iopsWrite"`
	BW        float64 `json:"bw"`      // MB/s
	BWRead    float64 `json:"bwRead"`  // MB/s
	BWWrite   float64 `json:"bwWrite"` // MB/s
	LatMean   float64 `json:"latMean"` // ms
	LatP95    float64 `json:"latP95"`  // ms
	LatP99    float64 `json:"latP99"`  // ms
	LatMax    float64 `json:"latMax"`  // ms
}

// StatusToStatsDataPoint aggregates a StatusUpdate into a single StatsDataPoint.
// The logic mirrors the frontend's convertStatusToDataPoint helper to keep
// values consistent between historical API data and live WebSocket updates.
func StatusToStatsDataPoint(status *StatusUpdate) *StatsDataPoint {
	if status == nil || len(status.Jobs) == 0 {
		return nil
	}

	var totalIOPS, totalIOPSRead, totalIOPSWrite float64
	var totalBW, totalBWRead, totalBWWrite float64

	type latAgg struct {
		mean float64
		p95  float64
		p99  float64
		max  float64
	}
	var latencies []latAgg

	for _, job := range status.Jobs {
		// IOPS aggregation
		totalIOPSRead += job.Read.IOPS
		totalIOPSWrite += job.Write.IOPS
		totalIOPS += job.Read.IOPS + job.Write.IOPS

		// Bandwidth aggregation: fio reports bw in KiB (1024-byte)/s; convert to bytes/sec
		const kib = 1024
		totalBWRead += float64(job.Read.BW) * kib
		totalBWWrite += float64(job.Write.BW) * kib
		totalBW += float64(job.Read.BW+job.Write.BW) * kib

		// Latency aggregation: prefer latency_ns, else latency_us, else clat_ns (fio status format)
		latNs := job.Read.LatencyNs
		if len(latNs) == 0 && len(job.Read.LatencyUs) > 0 {
			latNs = make([]Latency, len(job.Read.LatencyUs))
			for i, l := range job.Read.LatencyUs {
				latNs[i] = Latency{
					Percentile: l.Percentile,
					Value:      l.Value * 1000, // us -> ns
				}
			}
		}
		clatNs := job.Read.ClatNs
		if clatNs == nil {
			clatNs = job.Write.ClatNs
		}
		if len(latNs) == 0 && clatNs != nil {
			for k, v := range clatNs.Percentile {
				pct, err := strconv.ParseFloat(k, 64)
				if err != nil || pct < 0 || pct > 100 {
					continue
				}
				latNs = append(latNs, Latency{Percentile: uint32(pct), Value: v})
			}
		}

		if len(latNs) > 0 {
			meanMs := 0.0
			if clatNs != nil && clatNs.Mean > 0 {
				meanMs = clatNs.Mean / 1_000_000.0 // ns -> ms
			}
			var p95, p99, max float64
			for _, lat := range latNs {
				valueMs := float64(lat.Value) / 1_000_000.0
				switch lat.Percentile {
				case 95:
					p95 = valueMs
				case 99:
					p99 = valueMs
				case 100:
					max = valueMs
				}
				if meanMs == 0 && lat.Percentile <= 50 {
					meanMs = valueMs
				}
				if valueMs > max {
					max = valueMs
				}
			}
			latencies = append(latencies, latAgg{
				mean: meanMs,
				p95:  p95,
				p99:  p99,
				max:  max,
			})
		}
	}

	// Average latencies across jobs (use max of max for aggregate)
	var latMean, latP95, latP99, latMax float64
	if len(latencies) > 0 {
		for _, l := range latencies {
			latMean += l.mean
			latP95 += l.p95
			latP99 += l.p99
			if l.max > latMax {
				latMax = l.max
			}
		}
		n := float64(len(latencies))
		latMean /= n
		latP95 /= n
		latP99 /= n
	}

	// Normalize time to seconds: fio may output ms (1-60000) or Unix s (>=1e9)
	t := status.Time
	if t >= 1e9 {
		// Unix timestamp, already seconds
	} else if t >= 1000 {
		t = t / 1000 // ms -> seconds
	}
	// else t < 1000: assume already seconds

	return &StatsDataPoint{
		Time:      t,
		IOPS:      totalIOPS,
		IOPSRead:  totalIOPSRead,
		IOPSWrite: totalIOPSWrite,
		BW:        totalBW / (1024.0 * 1024.0), // bytes/sec -> MB/s
		BWRead:    totalBWRead / (1024.0 * 1024.0),
		BWWrite:   totalBWWrite / (1024.0 * 1024.0),
		LatMean:   latMean,
		LatP95:    latP95,
		LatP99:    latP99,
		LatMax:    latMax,
	}
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
