package server

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"

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
		state, err := s.executor.RunTasks(taskList.Tasks)
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
				ID        string             `json:"id"`
				Status    string             `json:"status"`
				StartTime string             `json:"start_time"`
				EndTime   string             `json:"end_time,omitempty"`
				Error     string             `json:"error,omitempty"`
				DiskBytes int64              `json:"disk_bytes"`
				Summary   *fio.RunSummary    `json:"summary,omitempty"`
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
