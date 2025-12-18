package server

import (
	"encoding/json"
	"net/http"
	"os"

	"github.com/gouxi/fio-webui/internal/fio"
)

type PageData struct {
	IOEngines []string
	RWTypes   []string
	Devices   []string
	Global    fio.GlobalConfig
	Job       fio.JobConfig
}

type OptionsResponse struct {
	IOEngines []string `json:"io_engines"`
	RWTypes   []string `json:"rw_types"`
	Devices   []string `json:"devices"`
}

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	data := PageData{
		IOEngines: fio.GetIOEngines(),
		RWTypes:   fio.GetRWTypes(),
		Devices:   fio.GetBlockDevices(),
		Global:    fio.DefaultGlobalConfig(),
		Job:       fio.DefaultJobConfig(),
	}

	if err := s.templates.ExecuteTemplate(w, "index.html", data); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
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

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var config fio.FioConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
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

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	state := s.executor.GetState()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(state)
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
