package fio

import (
	"bufio"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type LogType string

const (
	LogTypeBW   LogType = "bw"
	LogTypeIOPS LogType = "iops"
	LogTypeLat  LogType = "lat"
	LogTypeCLat LogType = "clat"
	LogTypeSLat LogType = "slat"
	LogTypeP99  LogType = "p99"
	LogTypeP95  LogType = "p95"
	LogTypeP90  LogType = "p90"
)

type LogEntry struct {
	Time      int64   `json:"time"`
	Value     float64 `json:"value"`
	Direction int     `json:"direction"`
	BlockSize int64   `json:"blocksize"`
	Percentile string `json:"percentile,omitempty"`
}

type LogData struct {
	Type    LogType    `json:"type"`
	Entries []LogEntry `json:"entries"`
}

type LogWatcher struct {
	prefix     string
	stopCh     chan struct{}
	dataCh     chan LogData
	statsCh    chan *FioStatsIncrement
	mu         sync.Mutex
	lastPos    map[string]int64
	lastStats  map[LogType]*LogEntryStats // Track cumulative values for increment calculation
}

// LogEntryStats tracks statistics for increment calculation
type LogEntryStats struct {
	Time      int64   // milliseconds
	ReadValue float64
	WriteValue float64
}

func NewLogWatcher(prefix string) *LogWatcher {
	return &LogWatcher{
		prefix:    prefix,
		stopCh:    make(chan struct{}),
		dataCh:    make(chan LogData, 100),
		statsCh:   make(chan *FioStatsIncrement, 100),
		lastPos:   make(map[string]int64),
		lastStats: make(map[LogType]*LogEntryStats),
	}
}

func (w *LogWatcher) DataChan() <-chan LogData {
	return w.dataCh
}

func (w *LogWatcher) StatsChan() <-chan *FioStatsIncrement {
	return w.statsCh
}

func (w *LogWatcher) Start() {
	go w.watch()
}

func (w *LogWatcher) Stop() {
	close(w.stopCh)
}

func (w *LogWatcher) watch() {
	// More frequent polling for real-time updates
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	// Try both formats: with job number (1) and without
	// Also support both lat and clat naming conventions
	logFiles := map[string]LogType{
		w.prefix + "_bw.1.log":    LogTypeBW,
		w.prefix + "_bw.log":      LogTypeBW,
		w.prefix + "_iops.1.log":  LogTypeIOPS,
		w.prefix + "_iops.log":    LogTypeIOPS,
		w.prefix + "_lat.1.log":   LogTypeCLat,
		w.prefix + "_lat.log":     LogTypeCLat,
		w.prefix + "_clat.1.log":  LogTypeCLat,
		w.prefix + "_clat.log":    LogTypeCLat,
	}

	for {
		select {
		case <-w.stopCh:
			close(w.dataCh)
			return
		case <-ticker.C:
			for file, logType := range logFiles {
				w.readNewEntries(file, logType)
			}
		}
	}
}

func (w *LogWatcher) readNewEntries(filename string, logType LogType) {
	file, err := os.Open(filename)
	if err != nil {
		return
	}
	defer file.Close()
	
	if Debug {
		log.Printf("[DEBUG] Reading log file: %s", filename)
	}

	w.mu.Lock()
	lastPos := w.lastPos[filename]
	w.mu.Unlock()

	if lastPos > 0 {
		file.Seek(lastPos, 0)
	}

	var entries []LogEntry
	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		entry, ok := parseLine(line)
		if ok {
			entries = append(entries, entry)
		}
	}

	if len(entries) > 0 {
		newPos, _ := file.Seek(0, 1)
		w.mu.Lock()
		w.lastPos[filename] = newPos

		// Calculate increments for stats
		if len(entries) > 0 {
			lastEntry := entries[len(entries)-1]
			currentStats := &LogEntryStats{
				Time: lastEntry.Time,
			}
			
			// Aggregate values (read=0, write=1 in direction field)
			for _, entry := range entries {
				if entry.Direction == 0 {
					currentStats.ReadValue += entry.Value
				} else {
					currentStats.WriteValue += entry.Value
				}
			}
			
			prevStats := w.lastStats[logType]
			if prevStats != nil {
				// Calculate increment
				durationMs := currentStats.Time - prevStats.Time
				if durationMs > 0 {
					durationSec := float64(durationMs) / 1000.0
					
					increment := &FioStatsIncrement{
						Time:     currentStats.Time,
						Duration: durationSec,
					}
					
					// Map log type to stats field
					switch logType {
					case LogTypeBW:
						readKiBps := (currentStats.ReadValue - prevStats.ReadValue) / durationSec / 1024
						writeKiBps := (currentStats.WriteValue - prevStats.WriteValue) / durationSec / 1024
						increment.BW = readKiBps + writeKiBps
						increment.BWRead = readKiBps
						increment.BWWrite = writeKiBps
					case LogTypeIOPS:
						increment.IOPSRead = (currentStats.ReadValue - prevStats.ReadValue) / durationSec
						increment.IOPSWrite = (currentStats.WriteValue - prevStats.WriteValue) / durationSec
						increment.IOPS = increment.IOPSRead + increment.IOPSWrite
					case LogTypeCLat, LogTypeLat:
						// For latency, use the latest value (mean)
						if len(entries) > 0 {
							increment.LatMean = entries[len(entries)-1].Value
						}
					case LogTypeP99:
						if len(entries) > 0 {
							increment.LatP99 = entries[len(entries)-1].Value
						}
					}
					
					select {
					case w.statsCh <- increment:
					default:
						// Channel full, skip
					}
				}
			}
			
			w.lastStats[logType] = currentStats
		}

		w.mu.Unlock()

		if Debug {
			log.Printf("[DEBUG] Sending %d log entries of type %s", len(entries), logType)
		}

		w.dataCh <- LogData{
			Type:    logType,
			Entries: entries,
		}
	}
}

func parseLine(line string) (LogEntry, bool) {
	parts := strings.Split(line, ",")
	if len(parts) < 4 {
		return LogEntry{}, false
	}

	timeMs, err := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
	if err != nil {
		return LogEntry{}, false
	}

	value, err := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
	if err != nil {
		return LogEntry{}, false
	}

	direction, err := strconv.Atoi(strings.TrimSpace(parts[2]))
	if err != nil {
		return LogEntry{}, false
	}

	blockSize, err := strconv.ParseInt(strings.TrimSpace(parts[3]), 10, 64)
	if err != nil {
		blockSize = 0
	}

	return LogEntry{
		Time:      timeMs,
		Value:     value,
		Direction: direction,
		BlockSize: blockSize,
	}, true
}
