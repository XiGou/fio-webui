package fio

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

var Debug bool

type RunStatus string

const (
	StatusIdle     RunStatus = "idle"
	StatusRunning  RunStatus = "running"
	StatusFinished RunStatus = "finished"
	StatusError    RunStatus = "error"
)

type RunState struct {
	ID        string    `json:"id"`
	Status    RunStatus `json:"status"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time,omitempty"`
	Error     string    `json:"error,omitempty"`
	Output    string    `json:"output,omitempty"`
}

type Executor struct {
	mu           sync.RWMutex
	state        *RunState
	streamParser *StreamJSONParser
	outputCh     chan string
	statusCh     chan *StatusUpdate
	cancel       context.CancelFunc
	cmd          *exec.Cmd
	WorkDir      string    // scratch for validate etc
	RunStore     *RunStore // persistent run records
	lastStats    *StatsDataPoint
	statsMu      sync.Mutex
}

func NewExecutor(workDir string, store *RunStore) *Executor {
	if workDir == "" {
		workDir = "./data"
	}
	os.MkdirAll(workDir, 0755)
	return &Executor{
		WorkDir:  workDir,
		RunStore: store,
		state: &RunState{
			Status: StatusIdle,
		},
		statusCh: make(chan *StatusUpdate, 100),
	}
}

func (e *Executor) GetState() RunState {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.state == nil {
		return RunState{Status: StatusIdle}
	}
	return *e.state
}

// func (e *Executor) GetLogWatcher() *LogWatcher {
// 	e.mu.RLock()
// 	defer e.mu.RUnlock()
// 	return e.logWatcher
// }

func (e *Executor) GetStreamParser() *StreamJSONParser {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.streamParser
}

func (e *Executor) GetOutputChan() <-chan string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.outputCh
}

func (e *Executor) GetStatusChan() <-chan *StatusUpdate {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.statusCh
}

// GetCurrentRunID returns the ID of the currently tracked run, if any.
func (e *Executor) GetCurrentRunID() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.state == nil {
		return ""
	}
	return e.state.ID
}

func (e *Executor) Run(config *FioConfig) (*RunState, error) {
	e.mu.Lock()
	if e.state != nil && e.state.Status == StatusRunning {
		e.mu.Unlock()
		return nil, fmt.Errorf("fio is already running")
	}

	if len(config.Jobs) == 0 {
		e.mu.Unlock()
		return nil, fmt.Errorf("no jobs to run")
	}

	runID := NewRunID()
	runDir := ""
	if e.RunStore != nil {
		var err error
		runDir, err = e.RunStore.EnsureRunDir(runID)
		if err != nil {
			e.mu.Unlock()
			return nil, fmt.Errorf("create run dir: %w", err)
		}
		taskList := &FioTaskList{Tasks: []FioTask{{Name: "task1", Global: config.Global, Jobs: config.Jobs}}}
		runConfig := &RunConfig{TaskList: taskList, Workflow: BuildWorkflowFromTaskList(taskList)}
		if err := e.RunStore.SaveConfig(runID, runConfig); err != nil {
			if Debug {
				log.Printf("[DEBUG] SaveConfig: %v", err)
			}
		}
	}
	if runDir == "" {
		runDir = filepath.Join(e.WorkDir, runID)
		os.MkdirAll(runDir, 0755)
	}
	logPrefix := runDir

	// Check if any job has stonewallAfter set
	hasStonewall := false
	for _, job := range config.Jobs {
		if job.StonewallAfter {
			hasStonewall = true
			break
		}
	}

	var jobFiles []string
	if hasStonewall {
		// Generate a single jobfile with all jobs and stonewall directives
		jobFile := filepath.Join(runDir, "job.fio")
		jobContent := config.ToINI(logPrefix, -1)
		if err := os.WriteFile(jobFile, []byte(jobContent), 0644); err != nil {
			e.mu.Unlock()
			return nil, fmt.Errorf("failed to write job file: %w", err)
		}
		jobFiles = []string{jobFile}
		if Debug {
			log.Printf("[DEBUG] Generated FIO config with stonewall:\n%s\n", jobContent)
		}
	} else {
		// Generate one jobfile per job (each job is a separate fio command)
		jobFiles = make([]string, len(config.Jobs))
		for i := range config.Jobs {
			jobFile := filepath.Join(runDir, fmt.Sprintf("job%d.fio", i))
			jobContent := config.ToINI(logPrefix, i)
			if err := os.WriteFile(jobFile, []byte(jobContent), 0644); err != nil {
				e.mu.Unlock()
				return nil, fmt.Errorf("failed to write job file for job %d: %w", i, err)
			}
			jobFiles[i] = jobFile
			if Debug {
				log.Printf("[DEBUG] Generated FIO config for job %d (%s):\n%s\n", i, config.Jobs[i].Name, jobContent)
			}
		}
	}

	if Debug {
		log.Printf("[DEBUG] Log prefix: %s\n", logPrefix)
		if hasStonewall {
			log.Printf("[DEBUG] Jobs: %d, using stonewall in single jobfile\n", len(config.Jobs))
		} else {
			log.Printf("[DEBUG] Jobs: %d, execution mode: %s\n", len(config.Jobs), map[bool]string{true: "sequential", false: "parallel"}[config.Sequential])
		}
	}

	e.state = &RunState{
		ID:        runID,
		Status:    StatusRunning,
		StartTime: time.Now(),
	}

	e.outputCh = make(chan string, 100)
	if e.statusCh == nil {
		e.statusCh = make(chan *StatusUpdate, 100)
	}

	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.mu.Unlock()

	if hasStonewall {
		// Single jobfile with stonewall - run once
		go e.runFio(ctx, config, jobFiles[0], runID, logPrefix, 0)
	} else if config.Sequential {
		go e.runFioSequential(ctx, config, jobFiles, runID, logPrefix)
	} else {
		go e.runFioParallel(ctx, config, jobFiles, runID, logPrefix)
	}

	return e.state, nil
}

// RunTasks runs multiple fio tasks sequentially (one task after another)
func (e *Executor) RunTasks(tasks []FioTask) (*RunState, error) {
	e.mu.Lock()
	if e.state != nil && e.state.Status == StatusRunning {
		e.mu.Unlock()
		return nil, fmt.Errorf("fio is already running")
	}

	if len(tasks) == 0 {
		e.mu.Unlock()
		return nil, fmt.Errorf("no tasks to run")
	}

	runID := NewRunID()
	runDir := ""
	if e.RunStore != nil {
		var err error
		runDir, err = e.RunStore.EnsureRunDir(runID)
		if err != nil {
			e.mu.Unlock()
			return nil, fmt.Errorf("create run dir: %w", err)
		}
		taskList := &FioTaskList{Tasks: tasks}
		runConfig := &RunConfig{TaskList: taskList, Workflow: BuildWorkflowFromTaskList(taskList)}
		if err := e.RunStore.SaveConfig(runID, runConfig); err != nil && Debug {
			log.Printf("[DEBUG] SaveConfig: %v", err)
		}
	}
	if runDir == "" {
		runDir = filepath.Join(e.WorkDir, runID)
		os.MkdirAll(runDir, 0755)
	}

	e.state = &RunState{
		ID:        runID,
		Status:    StatusRunning,
		StartTime: time.Now(),
	}

	e.outputCh = make(chan string, 100)
	if e.statusCh == nil {
		e.statusCh = make(chan *StatusUpdate, 100)
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.mu.Unlock()

	go e.runTasksSequential(ctx, tasks, runID, runDir)

	return e.state, nil
}

// runTasksSequential runs multiple tasks sequentially (one task after another)
func (e *Executor) runTasksSequential(ctx context.Context, tasks []FioTask, runID, runDir string) {
	for i, task := range tasks {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if i > 0 {
			// Log separator between tasks
			select {
			case e.outputCh <- fmt.Sprintf("\n--- Task %d/%d (%s) ---\n", i+1, len(tasks), task.Name):
			default:
			}
		}

		// Convert task to FioConfig
		config := &FioConfig{
			Global: task.Global,
			Jobs:   task.Jobs,
		}

		// Generate jobfile for this task
		hasStonewall := false
		for _, job := range task.Jobs {
			if job.StonewallAfter {
				hasStonewall = true
				break
			}
		}

		var jobFile string
		taskLogPrefix := filepath.Join(runDir, fmt.Sprintf("task%d", i))
		if hasStonewall {
			jobFile = filepath.Join(runDir, fmt.Sprintf("task%d.fio", i))
			jobContent := config.ToINI(taskLogPrefix, -1)
			if err := os.WriteFile(jobFile, []byte(jobContent), 0644); err != nil {
				e.setError(runID, fmt.Errorf("failed to write job file for task %d: %w", i, err))
				return
			}
		} else {
			// Generate one jobfile per job in this task
			if len(task.Jobs) == 0 {
				continue
			}
			jobFile = filepath.Join(runDir, fmt.Sprintf("task%d_job0.fio", i))
			jobContent := config.ToINI(taskLogPrefix, 0)
			if err := os.WriteFile(jobFile, []byte(jobContent), 0644); err != nil {
				e.setError(runID, fmt.Errorf("failed to write job file for task %d: %w", i, err))
				return
			}
		}

		// Run this task
		e.runFio(ctx, config, jobFile, runID, taskLogPrefix, i)
	}

	// All tasks completed
	e.mu.Lock()
	if e.streamParser != nil {
		e.streamParser.Stop()
	}
	if e.state != nil && e.state.ID == runID {
		e.state.EndTime = time.Now()
		if e.state.Status == StatusRunning {
			e.state.Status = StatusFinished
		}
		e.finalizeRun(runID)
	}
	e.mu.Unlock()
}

// runFioSequential runs multiple fio commands sequentially (one after another)
func (e *Executor) runFioSequential(ctx context.Context, config *FioConfig, jobFiles []string, runID, logPrefix string) {
	for i, jobFile := range jobFiles {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if i > 0 {
			// Log separator between jobs
			select {
			case e.outputCh <- fmt.Sprintf("\n--- Job %d/%d (%s) ---\n", i+1, len(jobFiles), config.Jobs[i].Name):
			default:
			}
		}

		e.runFio(ctx, config, jobFile, runID, logPrefix, i)
	}

	// All jobs completed
	e.mu.Lock()
	if e.streamParser != nil {
		e.streamParser.Stop()
	}
	if e.state != nil && e.state.ID == runID {
		e.state.EndTime = time.Now()
		if e.state.Status == StatusRunning {
			e.state.Status = StatusFinished
		}
		e.finalizeRun(runID)
	}
	e.mu.Unlock()
}

// runFioParallel runs multiple fio commands in parallel
func (e *Executor) runFioParallel(ctx context.Context, config *FioConfig, jobFiles []string, runID, logPrefix string) {
	var wg sync.WaitGroup
	for i, jobFile := range jobFiles {
		wg.Add(1)
		go func(idx int, jf string) {
			defer wg.Done()
			select {
			case e.outputCh <- fmt.Sprintf("\n--- Job %d/%d (%s) ---\n", idx+1, len(jobFiles), config.Jobs[idx].Name):
			default:
			}
			e.runFio(ctx, config, jf, runID, logPrefix, idx)
		}(i, jobFile)
	}

	wg.Wait()

	// All jobs completed
	e.mu.Lock()
	if e.streamParser != nil {
		e.streamParser.Stop()
	}
	if e.state != nil && e.state.ID == runID {
		e.state.EndTime = time.Now()
		if e.state.Status == StatusRunning {
			e.state.Status = StatusFinished
		}
		e.finalizeRun(runID)
	}
	e.mu.Unlock()
}

func (e *Executor) finalizeRun(runID string) {
	if e.RunStore == nil {
		return
	}
	e.statsMu.Lock()
	last := e.lastStats
	e.statsMu.Unlock()
	status, startTime, endTime, errMsg := string(e.state.Status), e.state.StartTime, e.state.EndTime, e.state.Error
	e.mu.Unlock()
	defer e.mu.Lock()
	dir := e.RunStore.RunDir(runID)
	diskBytes, _ := DirSize(dir)
	var summary *RunSummary
	if last != nil {
		summary = &RunSummary{
			IOPS: last.IOPS, IOPSRead: last.IOPSRead, IOPSWrite: last.IOPSWrite,
			BW: last.BW, BWRead: last.BWRead, BWWrite: last.BWWrite,
			LatMean: last.LatMean, LatP50: 0, LatP95: last.LatP95, LatP99: last.LatP99,
		}
	}
	meta := &RunMeta{
		ID:        runID,
		Status:    status,
		StartTime: startTime.Format(time.RFC3339),
		DiskBytes: diskBytes,
		Summary:   summary,
	}
	if !endTime.IsZero() {
		meta.EndTime = endTime.Format(time.RFC3339)
	}
	if errMsg != "" {
		meta.Error = errMsg
	}
	e.RunStore.SaveMeta(runID, meta)
}

func (e *Executor) runFio(ctx context.Context, config *FioConfig, jobFile, runID, logPrefix string, jobIndex int) {
	args := []string{}
	if config.Global.OutputFormat != "" {
		args = append(args, "--output-format="+config.Global.OutputFormat)
	}
	if config.Global.StatusInterval > 0 {
		args = append(args, fmt.Sprintf("--status-interval=%d", config.Global.StatusInterval))
	}
	args = append(args, jobFile)
	cmd := exec.CommandContext(ctx, "fio", args...)

	// Store cmd reference for stopping
	e.mu.Lock()
	e.cmd = cmd
	e.mu.Unlock()

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		e.setError(runID, err)
		return
	}

	stderr, err := cmd.StderrPipe()
	if err != nil {
		e.setError(runID, err)
		return
	}

	if err := cmd.Start(); err != nil {
		e.setError(runID, err)
		return
	}

	// Start stream parser to handle status JSON updates and route non-JSON output
	e.mu.Lock()
	e.streamParser = NewStreamJSONParser(stdout)
	e.streamParser.Start()
	e.mu.Unlock()

	var output string
	const maxOutputSize = 512 * 1024 // 512KB max output

	// Forward status updates from stream parser to status channel and persist
	// aggregated metrics for historical queries.
	go func(curRunID string) {
		for status := range e.streamParser.StatusChan() {
			// Convert to aggregated stats point and append to history file.
			if point := StatusToStatsDataPoint(status); point != nil {
				e.appendStatsPoint(curRunID, point)
			}

			// Forward raw status update for real-time WebSocket consumers.
			select {
			case e.statusCh <- status:
			case <-ctx.Done():
				return
			default:
				// Channel full, skip
			}
		}
	}(runID)

	// Forward output from stream parser to output channel and persist
	go func(curRunID string) {
		for line := range e.streamParser.OutputChan() {
			if len(output) < maxOutputSize {
				output += line
			}
			if e.RunStore != nil {
				e.RunStore.AppendOutput(curRunID, line)
			}
			select {
			case e.outputCh <- line:
			case <-ctx.Done():
				return
			default:
			}
		}
	}(runID)

	// Read stderr and send to output channel, persist
	go func(curRunID string) {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text() + "\n"
			if len(output) < maxOutputSize {
				output += line
			}
			if e.RunStore != nil {
				e.RunStore.AppendOutput(curRunID, line)
			}
			select {
			case e.outputCh <- line:
			default:
			}
		}
	}(runID)

	err = cmd.Wait()

	// Note: error handling and final state update moved to runFioSequential
	// This function only runs one jobfile, errors are accumulated
	if err != nil {
		e.mu.Lock()
		if e.state != nil && e.state.ID == runID {
			// Don't overwrite existing error, but log this one
			if e.state.Error == "" {
				e.state.Error = fmt.Sprintf("Job %d failed: %v", jobIndex+1, err)
			} else {
				e.state.Error += fmt.Sprintf("; Job %d: %v", jobIndex+1, err)
			}
			e.state.Status = StatusError
		}
		e.mu.Unlock()
	}
}

// appendStatsPoint appends a single StatsDataPoint to the run's stats file.
func (e *Executor) appendStatsPoint(runID string, point *StatsDataPoint) {
	if runID == "" || point == nil {
		return
	}
	e.statsMu.Lock()
	e.lastStats = point
	e.statsMu.Unlock()

	data, err := json.Marshal(point)
	if err != nil {
		if Debug {
			log.Printf("[DEBUG] Failed to marshal stats point: %v", err)
		}
		return
	}

	if e.RunStore != nil {
		if err := e.RunStore.AppendStatsLine(runID, data); err != nil && Debug {
			log.Printf("[DEBUG] AppendStatsLine: %v", err)
		}
		return
	}

	// Fallback: write to WorkDir (legacy)
	filename := filepath.Join(e.WorkDir, runID, "stats.jsonl")
	os.MkdirAll(filepath.Dir(filename), 0755)
	f, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		if Debug {
			log.Printf("[DEBUG] Failed to open stats file %s: %v", filename, err)
		}
		return
	}
	defer f.Close()
	f.Write(append(data, '\n'))
}

// GetStatsHistory reads the aggregated stats history for the given run ID.
func (e *Executor) GetStatsHistory(runID string) ([]StatsDataPoint, error) {
	if runID == "" {
		return []StatsDataPoint{}, nil
	}
	if e.RunStore != nil {
		return e.RunStore.GetStats(runID)
	}
	filename := filepath.Join(e.WorkDir, runID, "stats.jsonl")
	f, err := os.Open(filename)
	if err != nil {
		if os.IsNotExist(err) {
			return []StatsDataPoint{}, nil
		}
		return nil, err
	}
	defer f.Close()
	var points []StatsDataPoint
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		var p StatsDataPoint
		if err := json.Unmarshal(scanner.Bytes(), &p); err != nil {
			continue
		}
		points = append(points, p)
	}
	return points, scanner.Err()
}

type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ValidationResult struct {
	Valid    bool              `json:"valid"`
	Errors   []ValidationError `json:"errors,omitempty"`
	Warnings []ValidationError `json:"warnings,omitempty"`
}

// Validate checks if a fio configuration is valid using fio --parse-only
func (e *Executor) Validate(config *FioConfig) ValidationResult {
	if len(config.Jobs) == 0 {
		return ValidationResult{
			Valid: false,
			Errors: []ValidationError{
				{Field: "jobs", Message: "At least one job is required"},
			},
		}
	}

	// Generate jobfile content
	logPrefix := filepath.Join(e.WorkDir, "validate")
	hasStonewall := false
	for _, job := range config.Jobs {
		if job.StonewallAfter {
			hasStonewall = true
			break
		}
	}

	var jobFile string
	var jobContent string
	if hasStonewall {
		jobContent = config.ToINI(logPrefix, -1)
	} else {
		// Use first job for validation
		jobContent = config.ToINI(logPrefix, 0)
	}

	// Write temporary jobfile
	tmpFile := filepath.Join(e.WorkDir, "validate_tmp.fio")
	if err := os.WriteFile(tmpFile, []byte(jobContent), 0644); err != nil {
		return ValidationResult{
			Valid: false,
			Errors: []ValidationError{
				{Field: "file", Message: fmt.Sprintf("Failed to create temp file: %v", err)},
			},
		}
	}
	defer os.Remove(tmpFile)
	jobFile = tmpFile

	// Run fio --parse-only to validate
	args := []string{"--parse-only", jobFile}
	cmd := exec.Command("fio", args...)
	output, err := cmd.CombinedOutput()

	if err != nil {
		// Parse error output
		errorMsg := string(output)
		return ValidationResult{
			Valid: false,
			Errors: []ValidationError{
				{Field: "config", Message: errorMsg},
			},
		}
	}

	// Check for warnings in output
	var warnings []ValidationError
	outputStr := string(output)
	if len(outputStr) > 0 && !strings.Contains(outputStr, "fio:") {
		// Look for warning patterns
		if strings.Contains(outputStr, "warning") || strings.Contains(outputStr, "WARNING") {
			warnings = append(warnings, ValidationError{
				Field:   "config",
				Message: outputStr,
			})
		}
	}

	return ValidationResult{
		Valid:    true,
		Warnings: warnings,
	}
}

func (e *Executor) Stop() error {
	e.mu.Lock()
	cmd := e.cmd
	e.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return fmt.Errorf("no running fio process")
	}

	// Send SIGINT (Ctrl+C) to allow graceful shutdown
	if err := cmd.Process.Signal(syscall.SIGINT); err != nil {
		return fmt.Errorf("failed to stop fio: %w", err)
	}

	return nil
}

func (e *Executor) setError(runID string, err error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.streamParser != nil {
		e.streamParser.Stop()
	}

	if e.state != nil && e.state.ID == runID {
		e.state.Status = StatusError
		e.state.Error = err.Error()
		e.state.EndTime = time.Now()
		e.finalizeRun(runID)
	}
}
