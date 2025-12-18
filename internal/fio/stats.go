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
