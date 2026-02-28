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

// StatusUpdate represents the status JSON structure from fio's --status-interval output.
// Time is normalized to seconds. fio may output "time", "timestamp" (seconds), or "timestamp_ms" (ms).
// We unmarshal via fioStatusUpdateRaw and convert.
type StatusUpdate struct {
	Time   int64                  `json:"time"`
	Jobs   []JobStatus            `json:"jobs"`
	Errors map[string]interface{} `json:"errors,omitempty"`
}

// fioStatusUpdateRaw parses fio JSON which may have "time", "timestamp", or "timestamp_ms"
type fioStatusUpdateRaw struct {
	Time        int64       `json:"time"`
	Timestamp   int64       `json:"timestamp"`
	TimestampMs int64       `json:"timestamp_ms"`
	Jobs        []JobStatus `json:"jobs"`
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
// FioClatNs is fio's clat_ns format: object with mean and percentile map
type FioClatNs struct {
	Mean       float64           `json:"mean"`
	Percentile map[string]uint64 `json:"percentile"` // "50.000000" -> value in ns
}

type IOStats struct {
	IOPS      float64    `json:"iops"`
	BW        int64      `json:"bw"`       // bytes/sec
	Runtime   uint64     `json:"runtime"`  // milliseconds
	IOStats   []Stat     `json:"iostats"`
	LatencyNs []Latency  `json:"latency_ns"`
	LatencyUs []Latency  `json:"latency_us"`
	ClatNs    *FioClatNs `json:"clat_ns"` // fio status format
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
		var raw fioStatusUpdateRaw
		if err := json.Unmarshal([]byte(trimmedLine), &raw); err == nil && len(raw.Jobs) > 0 {
			status := rawToStatusUpdate(&raw)
			if status != nil {
				p.handleStatusUpdate(lineCount, trimmedLine, status)
				continue
			}
		}
		// Time/Jobs empty: try fio single-job format (job_start, read, write at top level)
		var single fioSingleJobLine
		if err := json.Unmarshal([]byte(trimmedLine), &single); err == nil && single.JobStart > 0 {
			if converted := singleJobToStatusUpdate(&single); converted != nil {
				p.handleStatusUpdate(lineCount, trimmedLine, converted)
				continue
			}
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
				var raw fioStatusUpdateRaw
				if err := json.Unmarshal([]byte(jsonBuffer), &raw); err == nil && len(raw.Jobs) > 0 {
					if Debug {
						log.Printf("[DEBUG] StreamJSONParser: Line %d - Completed multi-line JSON", lineCount)
					}
					if status := rawToStatusUpdate(&raw); status != nil {
						p.handleStatusUpdate(lineCount, jsonBuffer, status)
					}
					jsonBuffer = ""
					continue
				}
				var single fioSingleJobLine
				if err := json.Unmarshal([]byte(jsonBuffer), &single); err == nil && single.JobStart > 0 {
					if converted := singleJobToStatusUpdate(&single); converted != nil {
						p.handleStatusUpdate(lineCount, jsonBuffer, converted)
						jsonBuffer = ""
						continue
					}
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

// normalizeTimeToSeconds converts fio time to seconds.
// fio outputs: ms (1e3-1e6), usec (1e6-1e10), Unix s (1e9-1e10), or Unix ms (>=1e12).
func normalizeTimeToSeconds(t int64) int64 {
	if t <= 0 {
		return t
	}
	if t >= 1e12 {
		return t / 1000 // Unix ms -> s
	}
	if t >= 1e6 && t < 1e9 {
		return t / 1e6 // usec -> s
	}
	if t >= 1000 {
		return t / 1000 // ms -> s
	}
	return t // already seconds
}

// rawToStatusUpdate converts fioStatusUpdateRaw to StatusUpdate with Time normalized to seconds.
// fio outputs: "time" (varies), "timestamp" (Unix seconds), "timestamp_ms" (Unix ms).
func rawToStatusUpdate(raw *fioStatusUpdateRaw) *StatusUpdate {
	if raw == nil || len(raw.Jobs) == 0 {
		return nil
	}
	var t int64
	if raw.Time > 0 {
		t = normalizeTimeToSeconds(raw.Time)
	} else if raw.Timestamp > 0 {
		t = raw.Timestamp // already Unix seconds
	} else if raw.TimestampMs > 0 {
		t = raw.TimestampMs / 1000
	} else {
		return nil
	}
	return &StatusUpdate{Time: t, Jobs: raw.Jobs}
}

// singleJobToStatusUpdate converts fio's single-job JSON line to StatusUpdate so we can emit stats.
// Use elapsed (seconds since job start) for the x-axis; job_start is fixed per job and wrong for chart.
func singleJobToStatusUpdate(single *fioSingleJobLine) *StatusUpdate {
	if single == nil || (single.JobStart <= 0 && single.Elapsed == 0) {
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
	// Parse Write.ClatNs for write-only jobs
	var writeLatNs []Latency
	for k, v := range single.Write.ClatNs.Percentile {
		pct, err := strconv.ParseFloat(k, 64)
		if err != nil || pct < 0 || pct > 100 {
			continue
		}
		writeLatNs = append(writeLatNs, Latency{Percentile: uint32(pct), Value: v})
	}
	write := IOStats{
		IOPS:      single.Write.IOPS,
		BW:        single.Write.BW * kib,
		LatencyNs: writeLatNs,
	}
	// elapsed_sec is ideal for chart x-axis (0, 1, 2, ...); job_start is fixed and wrong
	var timeSec int64
	if single.Elapsed > 0 {
		timeSec = int64(single.Elapsed)
	} else {
		timeSec = normalizeTimeToSeconds(single.JobStart)
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
