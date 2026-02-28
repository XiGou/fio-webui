package fio

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// RunMeta holds metadata for a recorded run
type RunMeta struct {
	ID        string   `json:"id"`
	Status    string   `json:"status"`
	StartTime string   `json:"start_time"`
	EndTime   string   `json:"end_time,omitempty"`
	Error     string   `json:"error,omitempty"`
	DiskBytes int64    `json:"disk_bytes"`
	Summary   *RunSummary `json:"summary,omitempty"`
}

// RunSummary holds parsed IOPS, BW, Lat from the run
type RunSummary struct {
	IOPS      float64 `json:"iops"`
	IOPSRead  float64 `json:"iops_read"`
	IOPSWrite float64 `json:"iops_write"`
	BW        float64 `json:"bw"`
	BWRead    float64 `json:"bw_read"`
	BWWrite   float64 `json:"bw_write"`
	LatMean   float64 `json:"lat_mean"`
	LatP50    float64 `json:"lat_p50"`
	LatP95    float64 `json:"lat_p95"`
	LatP99    float64 `json:"lat_p99"`
}

// LogSummary holds parsed log summary and errors for frontend display
type LogSummary struct {
	Summary string   `json:"summary"` // Human-readable summary (key stats)
	Errors  []string `json:"errors"`   // Error lines only
}

// RunStore manages persisted run records under a base directory
type RunStore struct {
	baseDir string
	mu      sync.RWMutex
}

// NewRunStore creates a RunStore with the given base directory (e.g. ./data)
func NewRunStore(baseDir string) (*RunStore, error) {
	if baseDir == "" {
		baseDir = "./data"
	}
	runsDir := filepath.Join(baseDir, "runs")
	if err := os.MkdirAll(runsDir, 0755); err != nil {
		return nil, fmt.Errorf("create runs dir: %w", err)
	}
	return &RunStore{baseDir: baseDir}, nil
}

// RunDir returns the folder path for a run ID
func (s *RunStore) RunDir(runID string) string {
	return filepath.Join(s.baseDir, "runs", runID)
}

// EnsureRunDir creates the run folder and returns its path
func (s *RunStore) EnsureRunDir(runID string) (string, error) {
	dir := s.RunDir(runID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

// SaveMeta writes meta.json for a run
func (s *RunStore) SaveMeta(runID string, meta *RunMeta) error {
	dir := s.RunDir(runID)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "meta.json"), data, 0644)
}

// SaveConfig writes config.json (FioTaskList) for a run
func (s *RunStore) SaveConfig(runID string, config interface{}) error {
	dir := s.RunDir(runID)
	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "config.json"), data, 0644)
}

// AppendOutput appends a line to output.log
func (s *RunStore) AppendOutput(runID string, line string) error {
	dir := s.RunDir(runID)
	f, err := os.OpenFile(filepath.Join(dir, "output.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)
	return err
}

// AppendStatsLine appends a stats JSON line to stats.jsonl
func (s *RunStore) AppendStatsLine(runID string, line []byte) error {
	dir := s.RunDir(runID)
	f, err := os.OpenFile(filepath.Join(dir, "stats.jsonl"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	if !bytes.HasSuffix(line, []byte("\n")) {
		line = append(line, '\n')
	}
	_, err = f.Write(line)
	return err
}

// GetMeta reads meta.json for a run
func (s *RunStore) GetMeta(runID string) (*RunMeta, error) {
	dir := s.RunDir(runID)
	data, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	if err != nil {
		return nil, err
	}
	var meta RunMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, err
	}
	return &meta, nil
}

// GetConfig reads config.json and unmarshals into the given type
func (s *RunStore) GetConfig(runID string) (*FioTaskList, error) {
	dir := s.RunDir(runID)
	data, err := os.ReadFile(filepath.Join(dir, "config.json"))
	if err != nil {
		return nil, err
	}
	var cfg FioTaskList
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// GetLogSummary parses output.log and returns summary + errors only
func (s *RunStore) GetLogSummary(runID string) (*LogSummary, error) {
	dir := s.RunDir(runID)
	data, err := os.ReadFile(filepath.Join(dir, "output.log"))
	if err != nil {
		if os.IsNotExist(err) {
			return &LogSummary{Summary: "", Errors: nil}, nil
		}
		return nil, err
	}
	return ParseOutputForSummary(string(data)), nil
}

// ParseOutputForSummary extracts summary and error lines from fio stdout
func ParseOutputForSummary(output string) *LogSummary {
	lines := strings.Split(output, "\n")
	var errors []string
	var summaryParts []string
	var lastJSON string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}

		// Collect error-like lines
		lower := strings.ToLower(trimmed)
		if strings.Contains(lower, "error") || strings.Contains(lower, "fatal") ||
			strings.Contains(lower, "failed") || strings.Contains(lower, "cannot") {
			errors = append(errors, trimmed)
		}

		// Track last JSON line (fio final output)
		if strings.HasPrefix(trimmed, "{") {
			lastJSON = trimmed
		}
	}

	// Parse last JSON for summary stats
	if lastJSON != "" {
		if s := parseFioJSONSummary(lastJSON); s != "" {
			summaryParts = append(summaryParts, s)
		}
	}

	return &LogSummary{
		Summary: strings.Join(summaryParts, "\n"),
		Errors:  errors,
	}
}

// List returns all run IDs sorted by folder name (newest first by typical uuid/time)
func (s *RunStore) List() ([]string, error) {
	runsDir := filepath.Join(s.baseDir, "runs")
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var ids []string
	for _, e := range entries {
		if e.IsDir() {
			ids = append(ids, e.Name())
		}
	}
	// Sort by mod time descending (newest first)
	sort.Slice(ids, func(i, j int) bool {
		infoI, _ := os.Stat(s.RunDir(ids[i]))
		infoJ, _ := os.Stat(s.RunDir(ids[j]))
		if infoI == nil || infoJ == nil {
			return i < j
		}
		return infoI.ModTime().After(infoJ.ModTime())
	})
	return ids, nil
}

// DirSize returns total size in bytes of a directory
func DirSize(path string) (int64, error) {
	var size int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			size += info.Size()
		}
		return nil
	})
	return size, err
}

// Delete removes a run folder and all its contents
func (s *RunStore) Delete(runID string) error {
	dir := s.RunDir(runID)
	return os.RemoveAll(dir)
}

// GetStats reads stats.jsonl for a run
func (s *RunStore) GetStats(runID string) ([]StatsDataPoint, error) {
	dir := s.RunDir(runID)
	data, err := os.ReadFile(filepath.Join(dir, "stats.jsonl"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var points []StatsDataPoint
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var p StatsDataPoint
		if err := json.Unmarshal([]byte(line), &p); err != nil {
			continue
		}
		points = append(points, p)
	}
	return points, nil
}

// parseFioJSONSummary extracts key stats from fio JSON output
func parseFioJSONSummary(jsonStr string) string {
	var root struct {
		Jobs []struct {
			JobName string `json:"jobname"`
			Read    struct {
				IOPS float64 `json:"iops"`
				BW   int64   `json:"bw"`
			} `json:"read"`
			Write struct {
				IOPS float64 `json:"iops"`
				BW   int64   `json:"bw"`
			} `json:"write"`
		} `json:"jobs"`
	}
	if err := json.Unmarshal([]byte(jsonStr), &root); err != nil {
		return ""
	}
	var sb strings.Builder
	for _, j := range root.Jobs {
		iops := j.Read.IOPS + j.Write.IOPS
		bwKiB := (j.Read.BW + j.Write.BW) / 1024
		sb.WriteString(fmt.Sprintf("%s: IOPS=%.0f BW=%d MiB/s\n", j.JobName, iops, bwKiB))
	}
	return strings.TrimSpace(sb.String())
}
