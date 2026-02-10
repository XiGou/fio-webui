package fio

import (
	"bufio"
	"context"
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
	// logWatcher   *LogWatcher
	streamParser *StreamJSONParser
	outputCh     chan string
	cancel       context.CancelFunc
	cmd          *exec.Cmd
	WorkDir      string
}

func NewExecutor(workDir string) *Executor {
	if workDir == "" {
		workDir = "./data"
	}
	os.MkdirAll(workDir, 0755)
	return &Executor{
		WorkDir: workDir,
		state: &RunState{
			Status: StatusIdle,
		},
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

	runID := fmt.Sprintf("run_%d", time.Now().Unix())
	logPrefix := filepath.Join(e.WorkDir, runID)

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
		jobFile := filepath.Join(e.WorkDir, fmt.Sprintf("%s.fio", runID))
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
			jobFile := filepath.Join(e.WorkDir, fmt.Sprintf("%s_job%d.fio", runID, i))
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

	runID := fmt.Sprintf("run_%d", time.Now().Unix())
	logPrefix := filepath.Join(e.WorkDir, runID)

	e.state = &RunState{
		ID:        runID,
		Status:    StatusRunning,
		StartTime: time.Now(),
	}

	e.outputCh = make(chan string, 100)

	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.mu.Unlock()

	go e.runTasksSequential(ctx, tasks, runID, logPrefix)

	return e.state, nil
}

// runTasksSequential runs multiple tasks sequentially (one task after another)
func (e *Executor) runTasksSequential(ctx context.Context, tasks []FioTask, runID, logPrefix string) {
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
		taskLogPrefix := filepath.Join(logPrefix, fmt.Sprintf("task%d", i))
		if hasStonewall {
			jobFile = filepath.Join(e.WorkDir, fmt.Sprintf("%s_task%d.fio", runID, i))
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
			jobFile = filepath.Join(e.WorkDir, fmt.Sprintf("%s_task%d_job0.fio", runID, i))
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
	defer e.mu.Unlock()

	if e.streamParser != nil {
		e.streamParser.Stop()
	}

	if e.state != nil && e.state.ID == runID {
		e.state.EndTime = time.Now()
		if e.state.Status == StatusRunning {
			e.state.Status = StatusFinished
		}
	}
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
	defer e.mu.Unlock()

	if e.streamParser != nil {
		e.streamParser.Stop()
	}

	if e.state != nil && e.state.ID == runID {
		e.state.EndTime = time.Now()
		if e.state.Status == StatusRunning {
			e.state.Status = StatusFinished
		}
	}
}

// runFioParallel runs multiple fio commands in parallel
func (e *Executor) runFioParallel(ctx context.Context, config *FioConfig, jobFiles []string, runID, logPrefix string) {
	var wg sync.WaitGroup
	errCh := make(chan error, len(jobFiles))

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
	defer e.mu.Unlock()

	if e.streamParser != nil {
		e.streamParser.Stop()
	}

	if e.state != nil && e.state.ID == runID {
		e.state.EndTime = time.Now()
		if e.state.Status == StatusRunning {
			e.state.Status = StatusFinished
		}
	}
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

	// Forward output from stream parser to output channel
	go func() {
		for line := range e.streamParser.OutputChan() {
			if len(output) < maxOutputSize {
				output += line
			}
			// Send to channel for real-time updates
			select {
			case e.outputCh <- line:
			default:
				// Channel full, skip
			}
		}
	}()

	// Read stderr and send to output channel in real-time
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text() + "\n"
			if len(output) < maxOutputSize {
				output += line
			}
			// Send to channel for real-time updates
			select {
			case e.outputCh <- line:
			default:
				// Channel full, skip
			}
		}
	}()

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

type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

type ValidationResult struct {
	Valid   bool             `json:"valid"`
	Errors  []ValidationError `json:"errors,omitempty"`
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

	// if e.logWatcher != nil {
	// 	e.logWatcher.Stop()
	// }

	if e.streamParser != nil {
		e.streamParser.Stop()
	}

	if e.state != nil && e.state.ID == runID {
		e.state.Status = StatusError
		e.state.Error = err.Error()
		e.state.EndTime = time.Now()
	}
}
