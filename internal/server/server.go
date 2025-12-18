package server

import (
	"embed"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"

	"github.com/gorilla/websocket"
	"github.com/gouxi/fio-webui/internal/fio"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Server struct {
	executor  *fio.Executor
	templates *template.Template
	staticFS  fs.FS
	addr      string
	debug     bool
	logDir    string // Temporary directory for io logs
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

	templatesFS, err := fs.Sub(webFS, "web/templates")
	if err != nil {
		os.RemoveAll(logDir)
		return nil, err
	}

	tmpl, err := template.ParseFS(templatesFS, "*.html")
	if err != nil {
		os.RemoveAll(logDir)
		return nil, err
	}

	staticFS, err := fs.Sub(webFS, "web/static")
	if err != nil {
		os.RemoveAll(logDir)
		return nil, err
	}

	return &Server{
		executor:  fio.NewExecutor(logDir),
		templates: tmpl,
		staticFS:  staticFS,
		addr:      addr,
		debug:     debug,
		logDir:    logDir,
	}, nil
}

func (s *Server) Run() error {
	mux := http.NewServeMux()

	mux.HandleFunc("/", s.handleIndex)
	mux.HandleFunc("/api/options", s.handleOptions)
	mux.HandleFunc("/api/run", s.handleRun)
	mux.HandleFunc("/api/stop", s.handleStop)
	mux.HandleFunc("/api/status", s.handleStatus)
	mux.HandleFunc("/api/events", s.handleWebSocket)
	if s.debug {
		mux.HandleFunc("/api/debug/files", s.handleDebugFiles)
		log.Println("Debug mode enabled")
	}
	mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.FS(s.staticFS))))

	log.Printf("Server starting on %s", s.addr)
	defer s.Cleanup()
	return http.ListenAndServe(s.addr, mux)
}

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
