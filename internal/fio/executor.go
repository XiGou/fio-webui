package fio

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
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
				e.state.Error = fmt.Sprintf("Task group %d failed: %v", taskGroupIndex+1, err)
			} else {
				e.state.Error += fmt.Sprintf("; Task group %d: %v", taskGroupIndex+1, err)
			}
			e.state.Status = StatusError
		}
		e.mu.Unlock()
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
