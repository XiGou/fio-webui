package fio

import (
	"fmt"
	"slices"
	"strconv"
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
	StatusInterval int      `json:"status_interval"` // seconds between status updates
	OutputFormat   string   `json:"output_format"`   // json or normal
}

type JobConfig struct {
	Name           string `json:"name"`
	Filename       string `json:"filename"`
	RW             RWType `json:"rw"`
	BS             string `json:"bs"`
	Size           string `json:"size"`
	NumJobs        int    `json:"numjobs"`
	IODepth        int    `json:"iodepth"`
	RWMixRead      int    `json:"rwmixread"`
	Rate           string `json:"rate,omitempty"`
	StonewallAfter bool   `json:"stonewallAfter,omitempty"` // If true, insert stonewall after this job
	Runtime        int    `json:"runtime,omitempty"`        // Override global runtime for this job (0 means use global)
	IOEngine       string `json:"ioengine,omitempty"`       // Override global ioengine for this job (empty means use global)
	NodeID         string `json:"nodeId,omitempty"`         // Source workflow node ID for traceability
	ExtraOptions   map[string]any `json:"extra_options,omitempty"`
}

type FioConfig struct {
	Global     GlobalConfig `json:"global"`
	Jobs       []JobConfig  `json:"jobs"`
	Sequential bool         `json:"sequential"` // If true, run jobs sequentially (one fio command after another). If false, run in parallel.
}

// FioTask represents a complete fio command configuration
type FioTask struct {
	Name   string       `json:"name"`
	Global GlobalConfig `json:"global"`
	Jobs   []JobConfig  `json:"jobs"`
}

// FioTaskList contains multiple tasks to run sequentially
type FioTaskList struct {
	Tasks []FioTask `json:"tasks"`
}

func DefaultGlobalConfig() GlobalConfig {
	return GlobalConfig{
		IOEngine:       IOEngineLibaio,
		Direct:         true,
		Runtime:        60,
		TimeBased:      true,
		GroupReport:    true,
		LogAvgMsec:     500,
		StatusInterval: 1,      // 1 second status updates
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

// ToINI generates a jobfile for a single job (one fio command per job)
// If jobIndex is -1, generates a jobfile with all jobs and stonewall directives
func (c *FioConfig) ToINI(logPrefix string, jobIndex int) string {
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
	// output-format 与 status-interval 为 fio 命令行参数，见 executor.runFio
	// Enable real-time log output with aggressive flushing
	sb.WriteString("log_hist_msec=200\n")
	sb.WriteString("log_max_value=1\n")
	if logPrefix != "" {
		sb.WriteString(fmt.Sprintf("write_bw_log=%s\n", logPrefix))
		sb.WriteString(fmt.Sprintf("write_iops_log=%s\n", logPrefix))
		sb.WriteString(fmt.Sprintf("write_lat_log=%s\n", logPrefix))
		sb.WriteString("per_job_logs=0\n")
	}

	// If jobIndex is -1, generate all jobs with stonewall
	if jobIndex == -1 {
		for i, job := range c.Jobs {
			sb.WriteString(fmt.Sprintf("\n[%s]\n", job.Name))
			// Stonewall is emitted at the start of the next job section when the
			// previous job requested "stonewall after".
			if i > 0 && c.Jobs[i-1].StonewallAfter {
				sb.WriteString("stonewall\n")
			}
			writeJobConfig(&sb, job)
		}
		return sb.String()
	}

	// Single job - no stonewall needed, each job is a separate fio command
	if jobIndex < 0 || jobIndex >= len(c.Jobs) {
		return ""
	}
	job := c.Jobs[jobIndex]

	sb.WriteString(fmt.Sprintf("\n[%s]\n", job.Name))
	writeJobConfig(&sb, job)

	return sb.String()
}

func writeJobConfig(sb *strings.Builder, job JobConfig) {
	// Job-level overrides for runtime and ioengine
	if job.IOEngine != "" {
		sb.WriteString(fmt.Sprintf("ioengine=%s\n", job.IOEngine))
	}
	if job.Runtime > 0 {
		sb.WriteString(fmt.Sprintf("runtime=%d\n", job.Runtime))
	}
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
	writeExtraOptions(sb, job.ExtraOptions)
}

func writeExtraOptions(sb *strings.Builder, options map[string]any) {
	if len(options) == 0 {
		return
	}
	keys := make([]string, 0, len(options))
	for key := range options {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	for _, key := range keys {
		sb.WriteString(fmt.Sprintf("%s=%s\n", key, formatOptionValue(options[key])))
	}
}

func formatOptionValue(value any) string {
	switch typed := value.(type) {
	case bool:
		if typed {
			return "1"
		}
		return "0"
	case string:
		return typed
	case int:
		return strconv.Itoa(typed)
	case int8:
		return strconv.FormatInt(int64(typed), 10)
	case int16:
		return strconv.FormatInt(int64(typed), 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case int64:
		return strconv.FormatInt(typed, 10)
	case uint:
		return strconv.FormatUint(uint64(typed), 10)
	case uint8:
		return strconv.FormatUint(uint64(typed), 10)
	case uint16:
		return strconv.FormatUint(uint64(typed), 10)
	case uint32:
		return strconv.FormatUint(uint64(typed), 10)
	case uint64:
		return strconv.FormatUint(typed, 10)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return fmt.Sprint(typed)
	}
}
