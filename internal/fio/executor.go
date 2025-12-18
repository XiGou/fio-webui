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

	runID := fmt.Sprintf("run_%d", time.Now().Unix())
	logPrefix := filepath.Join(e.WorkDir, runID)
	jobFile := filepath.Join(e.WorkDir, runID+".fio")

	jobContent := config.ToINI(logPrefix)
	if err := os.WriteFile(jobFile, []byte(jobContent), 0644); err != nil {
		e.mu.Unlock()
		return nil, fmt.Errorf("failed to write job file: %w", err)
	}

	if Debug {
		log.Printf("[DEBUG] Generated FIO config:\n%s\n", jobContent)
		log.Printf("[DEBUG] Log prefix: %s\n", logPrefix)
	}

	e.state = &RunState{
		ID:        runID,
		Status:    StatusRunning,
		StartTime: time.Now(),
	}

	e.outputCh = make(chan string, 100)
	// e.logWatcher = NewLogWatcher(logPrefix)
	// e.logWatcher.Start()

	ctx, cancel := context.WithCancel(context.Background())
	e.cancel = cancel
	e.mu.Unlock()

	go e.runFio(ctx, jobFile, runID, logPrefix)

	return e.state, nil
}

func (e *Executor) runFio(ctx context.Context, jobFile, runID, logPrefix string) {
	cmd := exec.CommandContext(ctx, "fio", jobFile)

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

	e.mu.Lock()
	defer e.mu.Unlock()

	// if e.logWatcher != nil {
	// 	e.logWatcher.Stop()
	// }

	if e.streamParser != nil {
		e.streamParser.Stop()
	}

	if e.state != nil && e.state.ID == runID {
		e.state.EndTime = time.Now()
		e.state.Output = output
		if err != nil {
			e.state.Status = StatusError
			e.state.Error = err.Error()
		} else {
			e.state.Status = StatusFinished
		}
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
