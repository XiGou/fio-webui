package fio

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
	LatP50    float64 `json:"latP50"`  // ms
	LatP95    float64 `json:"latP95"`  // ms
	LatP99    float64 `json:"latP99"`  // ms
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
		p50  float64
		p95  float64
		p99  float64
	}
	var latencies []latAgg

	for _, job := range status.Jobs {
		// IOPS aggregation
		totalIOPSRead += job.Read.IOPS
		totalIOPSWrite += job.Write.IOPS
		totalIOPS += job.Read.IOPS + job.Write.IOPS

		// Bandwidth aggregation (bytes/sec)
		totalBWRead += float64(job.Read.BW)
		totalBWWrite += float64(job.Write.BW)
		totalBW += float64(job.Read.BW + job.Write.BW)

		// Latency aggregation (prefer ns over us)
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

		if len(latNs) > 0 {
			var mean, p50, p95, p99 float64
			for _, lat := range latNs {
				// Convert ns to ms
				valueMs := float64(lat.Value) / 1_000_000.0
				switch lat.Percentile {
				case 50:
					p50 = valueMs
				case 95:
					p95 = valueMs
				case 99:
					p99 = valueMs
				}
				// Estimate mean from available percentiles (use <= p50 as proxy)
				if lat.Percentile <= 50 {
					mean = valueMs
				}
			}
			latencies = append(latencies, latAgg{
				mean: mean,
				p50:  p50,
				p95:  p95,
				p99:  p99,
			})
		}
	}

	// Average latencies across jobs
	var latMean, latP50, latP95, latP99 float64
	if len(latencies) > 0 {
		for _, l := range latencies {
			latMean += l.mean
			latP50 += l.p50
			latP95 += l.p95
			latP99 += l.p99
		}
		n := float64(len(latencies))
		latMean /= n
		latP50 /= n
		latP95 /= n
		latP99 /= n
	}

	return &StatsDataPoint{
		Time:      status.Time,
		IOPS:      totalIOPS,
		IOPSRead:  totalIOPSRead,
		IOPSWrite: totalIOPSWrite,
		BW:        totalBW / (1024.0 * 1024.0), // bytes/sec -> MB/s
		BWRead:    totalBWRead / (1024.0 * 1024.0),
		BWWrite:   totalBWWrite / (1024.0 * 1024.0),
		LatMean:   latMean,
		LatP50:    latP50,
		LatP95:    latP95,
		LatP99:    latP99,
	}
}
