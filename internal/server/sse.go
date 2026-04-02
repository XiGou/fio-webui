package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	// "github.com/gouxi/fio-webui/internal/fio"
)

type SSEMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	sendSSE := func(msg SSEMessage) {
		data, _ := json.Marshal(msg)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
	}

	sendSSE(SSEMessage{Type: "connected", Data: nil})

	statusTicker := time.NewTicker(1 * time.Second)
	defer statusTicker.Stop()

	// logTicker := time.NewTicker(200 * time.Millisecond)
	// defer logTicker.Stop()

	ctx := r.Context()

	for {
		select {
		case <-ctx.Done():
			return
		case <-statusTicker.C:
			state := s.executor.GetState()
			sendSSE(SSEMessage{Type: "status", Data: state})
		// case <-logTicker.C:
		// 	if s.executor.GetState().Status == fio.StatusRunning {
		// 		watcher := s.executor.GetLogWatcher()
		// 		if watcher != nil {
		// 			// Drain all available log data
		// 			for {
		// 				select {
		// 				case logData := <-watcher.DataChan():
		// 					sendSSE(SSEMessage{Type: "log", Data: logData})
		// 				default:
		// 					goto nextIteration
		// 				}
		// 			}
		// 		}
		// 	}
		// nextIteration:
		}
	}
}
