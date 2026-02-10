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
	staticFS   fs.FS
	addr       string
	debug      bool
	logDir     string
	shutdownCh chan struct{} // 关闭后 Run() 退出并做优雅 Shutdown
}

func New(addr string, webFS embed.FS, debug bool) (*Server, error) {
	fio.Debug = debug

	// Create temporary directory for IO logs in memory (/dev/shm or /tmp)
	logDir := ""
	if info, err := os.Stat("/dev/shm"); err == nil && info.IsDir() {
		// Use /dev/shm if available (tmpfs on Linux)
		logDir, err = os.MkdirTemp("/dev/shm", "fio-webui-*")
		if err != nil {
			return nil, err
		}
	} else {
		// Fallback to /tmp
		logDir, err = os.MkdirTemp("", "fio-webui-*")
		if err != nil {
			return nil, err
		}
	}

	if debug {
		log.Printf("Log directory: %s", logDir)
	}

	distFS, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		os.RemoveAll(logDir)
		return nil, err
	}

	return &Server{
		executor:   fio.NewExecutor(logDir),
		staticFS:   distFS,
		addr:       addr,
		debug:      debug,
		logDir:     logDir,
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
	mux.HandleFunc("/api/events", s.handleWebSocket)
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

// Cleanup removes temporary log directory
func (s *Server) Cleanup() {
	if s.logDir != "" {
		if err := os.RemoveAll(s.logDir); err != nil {
			log.Printf("Failed to cleanup log directory %s: %v", s.logDir, err)
		} else if s.debug {
			log.Printf("Cleaned up log directory: %s", s.logDir)
		}
	}
}
