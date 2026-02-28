package fio

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"strconv"
	"strings"
	"sync"
)

// StatusUpdate represents the status JSON structure from fio's --status-interval output
type StatusUpdate struct {
	Time   int64                  `json:"time"`
	Jobs   []JobStatus            `json:"jobs"`
	Errors map[string]interface{} `json:"errors,omitempty"`
}

// JobStatus represents a single job's status in the status update
type JobStatus struct {
	JobName string  `json:"jobname"`
	GroupID int     `json:"groupid"`
	Error   int     `json:"error"`
	ETA     uint64  `json:"eta"`
	Elapsed uint64  `json:"elapsed"`
	Read    IOStats `json:"read"`
	Write   IOStats `json:"write"`
	Trim    IOStats `json:"trim"`
	Sync    IOStats `json:"sync"`
}

// IOStats represents read/write/trim statistics
type IOStats struct {
	IOPS      float64    `json:"iops"`
	BW        int64      `json:"bw"`       // bytes/sec
	Runtime   uint64     `json:"runtime"`  // milliseconds
	IOStats   []Stat     `json:"iostats"`
	LatencyNs []Latency  `json:"latency_ns"`
	LatencyUs []Latency  `json:"latency_us"`
}

// Latency represents a single latency measurement with percentile
type Latency struct {
	Percentile uint32 `json:"percentile"`
	Value      uint64 `json:"value"` // nanoseconds or microseconds
}

// Stat represents individual IO stat
type Stat struct {
	Name  string `json:"name"`
	Value int64  `json:"value"`
}

// fioSingleJobLine is the per-line JSON format fio uses for --status-interval (single job object at top level)
type fioSingleJobLine struct {
	JobStart int64          `json:"job_start"`
	JobName  string         `json:"jobname"`
	GroupID  int            `json:"groupid"`
	Error    int            `json:"error"`
	ETA      uint64         `json:"eta"`
	Elapsed  uint64         `json:"elapsed"`
	Read     fioIOStatsAlt  `json:"read"`
	Write    fioIOStatsAlt  `json:"write"`
}

type fioIOStatsAlt struct {
	IOPS    float64 `json:"iops"`
	BW      int64   `json:"bw"`
	Runtime uint64  `json:"runtime"`
	ClatNs  struct {
		Mean       float64           `json:"mean"`
		Percentile map[string]uint64 `json:"percentile"` // e.g. "50.000000" -> value in ns
	} `json:"clat_ns"`
}

// StreamJSONParser parses fio's real-time status JSON output
type StreamJSONParser struct {
	mu         sync.Mutex
	stopCh     chan struct{}
	statusCh   chan *StatusUpdate
	outputCh   chan string // non-JSON output lines
	reader     io.Reader
	lastStatus *StatusUpdate
}

// NewStreamJSONParser creates a new stream parser for fio status JSON
func NewStreamJSONParser(reader io.Reader) *StreamJSONParser {
	return &StreamJSONParser{
		stopCh:   make(chan struct{}),
		statusCh: make(chan *StatusUpdate, 100),
		outputCh: make(chan string, 100),
		reader:   reader,
	}
}

// StatusChan returns the channel for receiving status updates
func (p *StreamJSONParser) StatusChan() <-chan *StatusUpdate {
	return p.statusCh
}

// OutputChan returns the channel for receiving non-JSON output lines
func (p *StreamJSONParser) OutputChan() <-chan string {
	return p.outputCh
}

// Start begins parsing the stream
func (p *StreamJSONParser) Start() {
	if Debug {
		log.Printf("[DEBUG] StreamJSONParser: Starting parser")
	}
	go p.parse()
}

// Stop stops the parser
func (p *StreamJSONParser) Stop() {
	if Debug {
		log.Printf("[DEBUG] StreamJSONParser: Stopping parser")
	}
	close(p.stopCh)
}

// parse reads and parses JSON status updates from the stream
func (p *StreamJSONParser) parse() {
	defer func() {
		if Debug {
			log.Printf("[DEBUG] StreamJSONParser: Parser exiting")
		}
		close(p.statusCh)
		close(p.outputCh)
	}()

	// Use buffered reader and scanner to handle both JSON and non-JSON lines
	scanner := bufio.NewScanner(p.reader)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024) // 1MB buffer for large status updates

	lineCount := 0
	var jsonBuffer string // Buffer for multi-line JSON

	for {
		select {
		case <-p.stopCh:
			if Debug {
				log.Printf("[DEBUG] StreamJSONParser: Stop signal received, total lines: %d", lineCount)
			}
			return
		default:
		}

		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				log.Printf("[DEBUG] StreamJSONParser: Scanner error: %v", err)
			} else if Debug {
				log.Printf("[DEBUG] StreamJSONParser: Scanner EOF after %d lines", lineCount)
			}
			return
		}

		lineCount++
		line := scanner.Text()
		if len(line) == 0 {
			if Debug {
				log.Printf("[DEBUG] StreamJSONParser: Line %d is empty, skipping", lineCount)
			}
			continue
		}

		trimmedLine := strings.TrimSpace(line)
		if Debug {
			log.Printf("[DEBUG] StreamJSONParser: Line %d (%d bytes): %.100s", lineCount, len(line), trimmedLine)
		}

		// Try to parse current line as complete JSON first
		var status StatusUpdate
		if err := json.Unmarshal([]byte(trimmedLine), &status); err == nil {
			if status.Time > 0 && len(status.Jobs) > 0 {
				p.handleStatusUpdate(lineCount, trimmedLine, &status)
				continue
			}
			// Time/Jobs empty: try fio single-job format (job_start, read, write at top level)
			var single fioSingleJobLine
			if err2 := json.Unmarshal([]byte(trimmedLine), &single); err2 == nil && single.JobStart > 0 {
				if converted := singleJobToStatusUpdate(&single); converted != nil {
					p.handleStatusUpdate(lineCount, trimmedLine, converted)
					continue
				}
			}
			p.handleStatusUpdate(lineCount, trimmedLine, &status)
			continue
		}

		// Not valid JSON on its own, might be part of multi-line JSON or regular output
		// New object starts: either we have no buffer, or this line starts with '{'
		if strings.HasPrefix(trimmedLine, "{") {
			jsonBuffer = trimmedLine
			if Debug {
				log.Printf("[DEBUG] StreamJSONParser: Line %d - Starting JSON buffer", lineCount)
			}
			continue
		}

		// If we have buffered JSON, append this line and try to parse when we see '}'
		if jsonBuffer != "" {
			// New object starting: previous buffer was incomplete, start fresh
			if strings.HasPrefix(trimmedLine, "{") {
				jsonBuffer = trimmedLine
				if Debug {
					log.Printf("[DEBUG] StreamJSONParser: Line %d - New JSON object, reset buffer", lineCount)
				}
				continue
			}
			jsonBuffer += " " + trimmedLine
			if Debug {
				log.Printf("[DEBUG] StreamJSONParser: Line %d - Appending to JSON buffer (total: %d chars)", lineCount, len(jsonBuffer))
			}

			// Only try parse when line ends with '}' (possible end of top-level object)
			if strings.HasSuffix(trimmedLine, "}") {
				if err := json.Unmarshal([]byte(jsonBuffer), &status); err == nil {
					if Debug {
						log.Printf("[DEBUG] StreamJSONParser: Line %d - Completed multi-line JSON", lineCount)
					}
					if status.Time > 0 && len(status.Jobs) > 0 {
						p.handleStatusUpdate(lineCount, jsonBuffer, &status)
					} else {
						var single fioSingleJobLine
						if err2 := json.Unmarshal([]byte(jsonBuffer), &single); err2 == nil && single.JobStart > 0 {
							if converted := singleJobToStatusUpdate(&single); converted != nil {
								p.handleStatusUpdate(lineCount, jsonBuffer, converted)
							} else {
								p.handleStatusUpdate(lineCount, jsonBuffer, &status)
							}
						} else {
							p.handleStatusUpdate(lineCount, jsonBuffer, &status)
						}
					}
					jsonBuffer = ""
					continue
				}
				// Parse failed: might be inner '}' only (e.g. "clat_ns": { ... }). Keep appending.
				if Debug {
					log.Printf("[DEBUG] StreamJSONParser: Line %d - JSON buffer not complete yet (parse failed), continuing", lineCount)
				}
			}
			continue
		}

		// Regular non-JSON output line
		if Debug {
			log.Printf("[DEBUG] StreamJSONParser: Line %d is not valid JSON", lineCount)
		}
		p.sendOutput(lineCount, line)
	}
}

// handleStatusUpdate processes a valid status update
func (p *StreamJSONParser) handleStatusUpdate(lineCount int, lineStr string, status *StatusUpdate) {
	// Valid JSON, check if it's a status update
	if status.Time > 0 && len(status.Jobs) > 0 {
		if Debug {
			log.Printf("[DEBUG] StreamJSONParser: Line %d - Valid status update: time=%d, jobs=%d", lineCount, status.Time, len(status.Jobs))
		}

		p.mu.Lock()
		p.lastStatus = status
		p.mu.Unlock()

		select {
		case p.statusCh <- status:
			if Debug {
				log.Printf("[DEBUG] StreamJSONParser: Line %d status sent to statusCh", lineCount)
			}
		case <-p.stopCh:
			return
		default:
			// Channel full, skip
			log.Printf("[DEBUG] StreamJSONParser: Status channel full, dropping line %d", lineCount)
		}
	} else {
		// JSON but not a valid status update, send as output
		if Debug {
			log.Printf("[DEBUG] StreamJSONParser: Line %d - Valid JSON but not a status update (time=%d, jobs=%d)", lineCount, status.Time, len(status.Jobs))
		}
		p.sendOutput(lineCount, lineStr)
	}
}

// sendOutput sends a non-JSON output line to the output channel
func (p *StreamJSONParser) sendOutput(lineCount int, line string) {
	lineStr := line
	if !strings.HasSuffix(lineStr, "\n") {
		lineStr += "\n"
	}

	select {
	case p.outputCh <- lineStr:
		if Debug {
			log.Printf("[DEBUG] StreamJSONParser: Line %d sent to output", lineCount)
		}
	case <-p.stopCh:
		return
	default:
		// Output channel full, skip
		log.Printf("[DEBUG] StreamJSONParser: Output channel full, dropping line %d", lineCount)
	}
}

// GetLastStatus returns the most recent status update
func (p *StreamJSONParser) GetLastStatus() *StatusUpdate {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.lastStatus
}

// singleJobToStatusUpdate converts fio's single-job JSON line to StatusUpdate so we can emit stats.
// job_start is in ms (Unix or elapsed); we store Time in seconds for consistency with StatsDataPoint.
func singleJobToStatusUpdate(single *fioSingleJobLine) *StatusUpdate {
	if single == nil || single.JobStart <= 0 {
		return nil
	}
	var latNs []Latency
	for k, v := range single.Read.ClatNs.Percentile {
		pct, err := strconv.ParseFloat(k, 64)
		if err != nil || pct < 0 || pct > 100 {
			continue
		}
		latNs = append(latNs, Latency{Percentile: uint32(pct), Value: v})
	}
	// fio "bw" is in 1024-byte (KiB) per second; we store bytes/sec
	const kib = 1024
	read := IOStats{
		IOPS:      single.Read.IOPS,
		BW:        single.Read.BW * kib,
		LatencyNs: latNs,
	}
	write := IOStats{
		IOPS: single.Write.IOPS,
		BW:   single.Write.BW * kib,
	}
	timeSec := single.JobStart / 1000
	if timeSec <= 0 {
		timeSec = single.JobStart
	}
	return &StatusUpdate{
		Time: timeSec,
		Jobs: []JobStatus{{
			JobName: single.JobName,
			GroupID: single.GroupID,
			Error:   single.Error,
			ETA:     single.ETA,
			Elapsed: single.Elapsed,
			Read:    read,
			Write:   write,
		}},
	}
}

// ConvertToStatsIncrement converts StatusUpdate to FioStatsIncrement format for compatibility
func ConvertToStatsIncrement(status *StatusUpdate, prevStatus *StatusUpdate) *FioStatsIncrement {
	if status == nil || len(status.Jobs) == 0 {
		return nil
	}

	// Use first job's stats (can be extended to aggregate multiple jobs)
	job := status.Jobs[0]

	increment := &FioStatsIncrement{
		Time:       status.Time,
		IOPS:       job.Read.IOPS + job.Write.IOPS,
		IOPSRead:   job.Read.IOPS,
		IOPSWrite:  job.Write.IOPS,
		BW:         float64(job.Read.BW+job.Write.BW) / 1024.0, // Convert bytes to KiB
		BWRead:     float64(job.Read.BW) / 1024.0,
		BWWrite:    float64(job.Write.BW) / 1024.0,
	}

	if prevStatus != nil && len(prevStatus.Jobs) > 0 {
		durationMs := status.Time - prevStatus.Time
		if durationMs > 0 {
			increment.Duration = float64(durationMs) / 1000.0
		}

		// Extract latency from first job
		if len(job.Read.LatencyUs) > 0 {
			increment.LatMean = float64(job.Read.LatencyUs[0].Value)
		}

		// Extract P99 latency if available (typically stored separately in fio)
		for _, lat := range job.Read.LatencyNs {
			if lat.Percentile == 99 {
				increment.LatP99 = float64(lat.Value) / 1000.0 // Convert ns to us
				break
			}
		}
	}

	return increment
}
