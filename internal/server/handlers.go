package server

import (
	"bytes"
	"encoding/json"
	"html/template"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gouxi/fio-webui/internal/fio"
)

type OptionsResponse struct {
	IOEngines []string `json:"io_engines"`
	RWTypes   []string `json:"rw_types"`
	Devices   []string `json:"devices"`
}

type DefaultsResponse struct {
	Global fio.GlobalConfig `json:"global"`
	Job    fio.JobConfig    `json:"job"`
}

type RunRequest struct {
	Tasks           []fio.FioTask `json:"tasks"`
	WorkflowID      string        `json:"workflow_id,omitempty"`
	WorkflowVersion int           `json:"workflow_version,omitempty"`
	CompiledAt      string        `json:"compiled_at,omitempty"`
}

func (s *Server) handleOptions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(OptionsResponse{
		IOEngines: fio.GetIOEngines(),
		RWTypes:   fio.GetRWTypes(),
		Devices:   fio.GetBlockDevices(),
	})
}

func (s *Server) handleDefaults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(DefaultsResponse{
		Global: fio.DefaultGlobalConfig(),
		Job:    fio.DefaultJobConfig(),
	})
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Try to decode as FioTaskList first
	var taskList fio.FioTaskList
	bodyBytes := make([]byte, 0)
	if r.Body != nil {
		bodyBytes, _ = io.ReadAll(r.Body)
		r.Body.Close()
	}

	// Try FioTaskList first
	if err := json.Unmarshal(bodyBytes, &taskList); err == nil && len(taskList.Tasks) > 0 {
		state, err := s.executor.RunTasks(taskList.Tasks, nil)
		if err != nil {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(state)
		return
	}

	var runReq RunRequest
	if err := json.Unmarshal(bodyBytes, &runReq); err == nil && len(runReq.Tasks) > 0 {
		compiledAt := runReq.CompiledAt
		if compiledAt == "" {
			compiledAt = time.Now().Format(time.RFC3339)
		}
		metadata := &fio.RunMetadata{WorkflowID: runReq.WorkflowID, WorkflowVersion: runReq.WorkflowVersion, CompiledAt: compiledAt}
		state, err := s.executor.RunTasks(runReq.Tasks, metadata)
		if err != nil {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(state)
		return
	}

	// Fallback to FioConfig (backward compatibility)
	var config fio.FioConfig
	if err := json.Unmarshal(bodyBytes, &config); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	state, err := s.executor.Run(&config)
	if err != nil {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := s.executor.Stop(); err != nil {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

func (s *Server) handleValidate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var config fio.FioConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	result := s.executor.Validate(&config)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	state := s.executor.GetState()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
}

// handleStatsHistory returns aggregated performance metrics for the current run.
// The backend persists one JSON line per data point while fio is running, and
// this endpoint simply streams them back as an array for initial chart render.
func (s *Server) handleStatsHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	runID := s.executor.GetCurrentRunID()
	points, err := s.executor.GetStatsHistory(runID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(points)
}

func (s *Server) handleRuns(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/runs")
	path = strings.Trim(path, "/")
	parts := strings.SplitN(path, "/", 2)
	id := parts[0]
	sub := ""
	if len(parts) > 1 {
		sub = parts[1]
	}

	switch r.Method {
	case http.MethodGet:
		if id == "" {
			ids, err := s.runStore.List()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			type runItem struct {
				ID        string          `json:"id"`
				Status    string          `json:"status"`
				StartTime string          `json:"start_time"`
				EndTime   string          `json:"end_time,omitempty"`
				Error     string          `json:"error,omitempty"`
				DiskBytes int64           `json:"disk_bytes"`
				Summary   *fio.RunSummary `json:"summary,omitempty"`
			}
			items := make([]runItem, 0, len(ids))
			for _, rid := range ids {
				meta, err := s.runStore.GetMeta(rid)
				if err != nil {
					continue
				}
				items = append(items, runItem{
					ID: meta.ID, Status: meta.Status, StartTime: meta.StartTime, EndTime: meta.EndTime,
					Error: meta.Error, DiskBytes: meta.DiskBytes, Summary: meta.Summary,
				})
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(items)
			return
		}
		if sub == "log-summary" {
			summary, err := s.runStore.GetLogSummary(id)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(summary)
			return
		}
		if sub == "stats" {
			points, err := s.runStore.GetStats(id)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(points)
			return
		}
		if sub == "report-data" {
			view := &fio.ReportViewConfig{Metric: r.URL.Query().Get("metric"), TimeRange: r.URL.Query().Get("timeRange")}
			report, err := s.runStore.BuildRunReport(id, view)
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(report)
			return
		}
		if sub == "report.html" {
			view := &fio.ReportViewConfig{Metric: r.URL.Query().Get("metric"), TimeRange: r.URL.Query().Get("timeRange")}
			report, err := s.runStore.BuildRunReport(id, view)
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			reportJSON, err := json.Marshal(report)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			escapedData := template.JSEscapeString(string(reportJSON))
			html := strings.ReplaceAll(s.reportTpl, "__REPORT_DATA__", escapedData)
			html = strings.ReplaceAll(html, "__REPORT_GENERATED_AT__", strconv.FormatInt(time.Now().Unix(), 10))
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Content-Disposition", "attachment; filename=\""+reportFileName(id, "html")+"\"")
			http.ServeContent(w, r, "", time.Now(), bytes.NewReader([]byte(html)))
			return
		}
		meta, err := s.runStore.GetMeta(id)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		cfg, _ := s.runStore.GetConfig(id)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"meta": meta, "config": cfg,
		})
	case http.MethodDelete:
		if id == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}
		if err := s.runStore.Delete(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func reportFileName(runID string, ext string) string {
	now := time.Now().Format("20060102-150405")
	cleanID := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, runID)
	return "run-" + cleanID + "-" + now + "." + ext
}

func (s *Server) handleDebugFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	state := s.executor.GetState()

	response := map[string]interface{}{
		"state":   state,
		"workdir": s.executor.WorkDir,
		"files":   []string{},
	}

	// List files in work directory
	if entries, err := os.ReadDir(s.executor.WorkDir); err == nil {
		for _, entry := range entries {
			response["files"] = append(response["files"].([]string), entry.Name())
		}
	}

	json.NewEncoder(w).Encode(response)
}
