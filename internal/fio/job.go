package fio

import (
	"fmt"
	"strings"
)

type IOEngine string

const (
	IOEngineSync     IOEngine = "sync"
	IOEngineLibaio   IOEngine = "libaio"
	IOEngineIOUring  IOEngine = "io_uring"
	IOEnginePosixaio IOEngine = "posixaio"
)

type RWType string

const (
	RWRead      RWType = "read"
	RWWrite     RWType = "write"
	RWRandRead  RWType = "randread"
	RWRandWrite RWType = "randwrite"
	RWRandRW    RWType = "randrw"
	RWReadWrite RWType = "readwrite"
)

type GlobalConfig struct {
	IOEngine       IOEngine `json:"ioengine"`
	Direct         bool     `json:"direct"`
	Runtime        int      `json:"runtime"`
	TimeBased      bool     `json:"time_based"`
	GroupReport    bool     `json:"group_reporting"`
	LogAvgMsec     int      `json:"log_avg_msec"`
	StatusInterval int      `json:"status_interval"`  // seconds between status updates
	OutputFormat   string   `json:"output_format"`    // json or normal
}

type JobConfig struct {
	Name      string `json:"name"`
	Filename  string `json:"filename"`
	RW        RWType `json:"rw"`
	BS        string `json:"bs"`
	Size      string `json:"size"`
	NumJobs   int    `json:"numjobs"`
	IODepth   int    `json:"iodepth"`
	RWMixRead int    `json:"rwmixread"`
	Rate      string `json:"rate,omitempty"`
}

type FioConfig struct {
	Global GlobalConfig `json:"global"`
	Jobs   []JobConfig  `json:"jobs"`
}

func DefaultGlobalConfig() GlobalConfig {
	return GlobalConfig{
		IOEngine:       IOEngineLibaio,
		Direct:         true,
		Runtime:        60,
		TimeBased:      true,
		GroupReport:    true,
		LogAvgMsec:     500,
		StatusInterval: 1,     // 1 second status updates
		OutputFormat:   "json", // JSON format for status updates
	}
}

func DefaultJobConfig() JobConfig {
	return JobConfig{
		Name:      "job1",
		Filename:  "/tmp/fio-test",
		RW:        RWRandRead,
		BS:        "4k",
		Size:      "1G",
		NumJobs:   1,
		IODepth:   32,
		RWMixRead: 70,
	}
}

func (c *FioConfig) ToINI(logPrefix string) string {
	var sb strings.Builder

	sb.WriteString("[global]\n")
	sb.WriteString(fmt.Sprintf("ioengine=%s\n", c.Global.IOEngine))
	if c.Global.Direct {
		sb.WriteString("direct=1\n")
	}
	if c.Global.Runtime > 0 {
		sb.WriteString(fmt.Sprintf("runtime=%d\n", c.Global.Runtime))
	}
	if c.Global.TimeBased {
		sb.WriteString("time_based\n")
	}
	if c.Global.GroupReport {
		sb.WriteString("group_reporting\n")
	}
	if c.Global.LogAvgMsec > 0 {
		sb.WriteString(fmt.Sprintf("log_avg_msec=%d\n", c.Global.LogAvgMsec))
	}
	// Enable output format for JSON status output
	if c.Global.OutputFormat != "" {
		sb.WriteString(fmt.Sprintf("output-format=%s\n", c.Global.OutputFormat))
	}
	// Enable status-interval for real-time JSON status output
	if c.Global.StatusInterval > 0 {
		sb.WriteString(fmt.Sprintf("status-interval=%d\n", c.Global.StatusInterval))
	}
	// Enable real-time log output with aggressive flushing
	sb.WriteString("log_hist_msec=200\n")
	sb.WriteString("log_max_value=1\n")
	if logPrefix != "" {
		sb.WriteString(fmt.Sprintf("write_bw_log=%s\n", logPrefix))
		sb.WriteString(fmt.Sprintf("write_iops_log=%s\n", logPrefix))
		sb.WriteString(fmt.Sprintf("write_lat_log=%s\n", logPrefix))
		sb.WriteString("per_job_logs=0\n")
	}

	for _, job := range c.Jobs {
		sb.WriteString(fmt.Sprintf("\n[%s]\n", job.Name))
		sb.WriteString(fmt.Sprintf("filename=%s\n", job.Filename))
		sb.WriteString(fmt.Sprintf("rw=%s\n", job.RW))
		sb.WriteString(fmt.Sprintf("bs=%s\n", job.BS))
		sb.WriteString(fmt.Sprintf("size=%s\n", job.Size))
		sb.WriteString(fmt.Sprintf("numjobs=%d\n", job.NumJobs))
		sb.WriteString(fmt.Sprintf("iodepth=%d\n", job.IODepth))
		if job.RW == RWRandRW || job.RW == RWReadWrite || job.RW == "rw" {
			sb.WriteString(fmt.Sprintf("rwmixread=%d\n", job.RWMixRead))
		}
		if job.Rate != "" {
			sb.WriteString(fmt.Sprintf("rate=%s\n", job.Rate))
		}
	}

	return sb.String()
}
