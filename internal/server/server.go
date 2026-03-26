package server

import (
	"context"
	"errors"
	"fmt"
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
	executor      *fio.Executor
	runStore      *fio.RunStore
	workflowStore *fio.WorkflowStore
	staticHandler http.Handler
	addr          string
	debug         bool
	dataDir       string
	reportTpl     string
	shutdownCh    chan struct{}
}

func New(addr string, webFS fs.FS, debug bool, dataDir string) (*Server, error) {
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
	workflowStore, err := fio.NewWorkflowStore(dataDir)
	if err != nil {
		return nil, err
	}
	exec := fio.NewExecutor(dataDir, store)
	if debug {
		log.Printf("Data directory: %s", dataDir)
	}
	staticHandler, err := newStaticHandler(webFS)
	if err != nil {
		return nil, err
	}
	reportTplBytes, err := fs.ReadFile(webFS, "web/report-template/report.html")
	if err != nil {
		return nil, err
	}
	return &Server{
		executor:      exec,
		runStore:      store,
		workflowStore: workflowStore,
		staticHandler: staticHandler,
		addr:          addr,
		debug:         debug,
		dataDir:       dataDir,
		reportTpl:     string(reportTplBytes),
		shutdownCh:    make(chan struct{}),
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
	mux.HandleFunc("/api/workflows", s.handleWorkflows)
	mux.HandleFunc("/api/workflows/", s.handleWorkflows)
	if s.debug {
		mux.HandleFunc("/api/debug/files", s.handleDebugFiles)
		log.Println("Debug mode enabled")
	}
	mux.Handle("/", s.staticHandler)

	srv := &http.Server{Addr: s.addr, Handler: mux}
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

func newStaticHandler(webFS fs.FS) (http.Handler, error) {
	distFS, err := fs.Sub(webFS, "web/dist")
	if err == nil {
		if _, statErr := fs.Stat(distFS, "."); statErr == nil {
			return http.FileServer(http.FS(distFS)), nil
		} else if !errors.Is(statErr, fs.ErrNotExist) {
			return nil, statErr
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}

	log.Printf("Embedded frontend assets not found at web/dist; serving placeholder page")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprint(w, missingFrontendHTML)
	}), nil
}

const missingFrontendHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Frontend Build Required</title>
  <style>
    :root {
      color-scheme: light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      background: #f5f7fb;
      color: #162033;
    }
    main {
      max-width: 720px;
      margin: 10vh auto;
      padding: 32px;
      background: #ffffff;
      border: 1px solid #d9e1f2;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(22, 32, 51, 0.08);
    }
    h1 {
      margin-top: 0;
      font-size: 2rem;
    }
    p, li {
      line-height: 1.6;
    }
    code {
      padding: 0.2rem 0.4rem;
      background: #eef3ff;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <main>
    <h1>Frontend assets are not built</h1>
    <p>The Go backend started successfully, but no embedded files were found under <code>web/dist</code>.</p>
    <p>Build the frontend before compiling the binary:</p>
    <ul>
      <li><code>cd frontend && npm install && npm run build</code></li>
      <li><code>go build -o fio-webui .</code></li>
    </ul>
    <p>For local development, run the Vite dev server with <code>make dev</code> or <code>make dev-frontend</code>.</p>
  </main>
</body>
</html>
`
