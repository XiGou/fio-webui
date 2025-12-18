package server

import (
	"log"
	"net/http"
	"time"

	// "github.com/gouxi/fio-webui/internal/fio"
	"github.com/gorilla/websocket"
)

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	if s.debug {
		log.Printf("WebSocket client connected")
	}

	sendMsg := func(msg SSEMessage) {
		if err := conn.WriteJSON(msg); err != nil {
			if s.debug {
				log.Printf("WebSocket write error: %v", err)
			}
		}
	}

	// Send initial connected message
	sendMsg(SSEMessage{Type: "connected", Data: nil})

	statusTicker := time.NewTicker(1 * time.Second)
	defer statusTicker.Stop()

	// More frequent log polling for real-time updates
	// logTicker := time.NewTicker(100 * time.Millisecond)
	// defer logTicker.Stop()

	for {
		select {
		case <-statusTicker.C:
			state := s.executor.GetState()
			sendMsg(SSEMessage{Type: "status", Data: state})

		// case <-logTicker.C:
		// 	if s.executor.GetState().Status == fio.StatusRunning {
		// 		watcher := s.executor.GetLogWatcher()
		// 		if watcher != nil {
		// 			// Process incremental stats from log watcher
		// 			for i := 0; i < 10; i++ {
		// 				select {
		// 				case statsIncrement := <-watcher.StatsChan():
		// 					sendMsg(SSEMessage{Type: "stats", Data: statsIncrement})
		// 				default:
		// 					break
		// 				}
		// 			}
		// 		}
		// 	}

		case line := <-s.executor.GetOutputChan():
			// Only send output when there's actually new data
			if line != "" {
				sendMsg(SSEMessage{Type: "output", Data: map[string]interface{}{
					"line": line,
				}})
			}
		}

		// Check if client disconnected
		if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(time.Second)); err != nil {
			if s.debug {
				log.Printf("WebSocket client disconnected")
			}
			return
		}
	}
}
