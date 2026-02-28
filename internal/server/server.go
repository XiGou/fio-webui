package server

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
	"github.com/gouxi/fio-webui/internal/fio"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Server struct {
	executor   *fio.Executor
	runStore   *fio.RunStore
	staticFS   fs.FS
	addr       string
	debug      bool
	dataDir    string
	shutdownCh chan struct{}
}

func New(addr string, webFS embed.FS, debug bool, dataDir string) (*Server, error) {
	fio.Debug = debug
	if dataDir == "" {
		dataDir = "./data"
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return nil, err
	}
	store, err := fio.NewRunStore(dataDir)
	if err != nil {
		return nil, err
	}
	exec := fio.NewExecutor(dataDir, store)
	if debug {
		log.Printf("Data directory: %s", dataDir)
	}
	distFS, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		return nil, err
	}
	return &Server{
		executor:   exec,
		runStore:   store,
		staticFS:   distFS,
		addr:       addr,
		debug:      debug,
		dataDir:    dataDir,
		shutdownCh: make(chan struct{}),
	}, nil
}

func (s *Server) Run() error {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/options", s.handleOptions)
	mux.HandleFunc("/api/defaults", s.handleDefaults)
	mux.HandleFunc("/api/validate", s.handleValidate)
	mux.HandleFunc("/api/run", s.handleRun)
	mux.HandleFunc("/api/stop", s.handleStop)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/stats", s.handleStatsHistory)
	mux.HandleFunc("/api/events", s.handleWebSocket)
	mux.HandleFunc("/api/runs", s.handleRuns)
	mux.HandleFunc("/api/runs/", s.handleRuns)
	if s.debug {
		mux.HandleFunc("/api/debug/files", s.handleDebugFiles)
		log.Println("Debug mode enabled")
	}
	mux.Handle("/", http.FileServer(http.FS(s.staticFS)))

	srv := &http.Server{ Addr: s.addr, Handler: mux }
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP server error: %v", err)
		}
	}()

	log.Printf("Server starting on %s", s.addr)
	<-s.shutdownCh
	defer s.Cleanup()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Shutdown: %v", err)
	}
	return nil
}

// Shutdown 触发优雅退出（供 signal 或测试调用）
func (s *Server) Shutdown() { close(s.shutdownCh) }

// Cleanup runs on shutdown (data is persistent, no cleanup needed)
func (s *Server) Cleanup() {}
