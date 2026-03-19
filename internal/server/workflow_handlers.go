package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gouxi/fio-webui/internal/fio"
)

type createWorkflowRequest struct {
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Description   string          `json:"description"`
	Tags          []string        `json:"tags"`
	CreatedBy     string          `json:"created_by"`
	Workflow      json.RawMessage `json:"workflow"`
	SchemaVersion int             `json:"schema_version"`
}

type updateWorkflowRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
}

type publishWorkflowVersionRequest struct {
	CreatedBy     string          `json:"created_by"`
	ChangeLog     string          `json:"change_log"`
	SchemaVersion int             `json:"schema_version"`
	Workflow      json.RawMessage `json:"workflow"`
}

func (s *Server) handleWorkflows(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/workflows")
	path = strings.Trim(path, "/")
	parts := strings.Split(path, "/")
	id := ""
	if len(parts) > 0 {
		id = parts[0]
	}

	w.Header().Set("Content-Type", "application/json")

	if id == "" {
		s.handleWorkflowCollection(w, r)
		return
	}

	if len(parts) > 1 && parts[1] == "versions" {
		s.handleWorkflowVersions(w, r, id, parts[2:])
		return
	}

	switch r.Method {
	case http.MethodGet:
		t, err := s.workflowStore.Get(id)
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(t)
	case http.MethodPut, http.MethodPatch:
		var req updateWorkflowRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		meta, err := s.workflowStore.UpdateMetadata(id, fio.WorkflowTemplateMetadata{Name: req.Name, Description: req.Description, Tags: req.Tags})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(meta)
	case http.MethodDelete:
		if err := s.workflowStore.Delete(id); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleWorkflowCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.workflowStore.List()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var req createWorkflowRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		t, err := s.workflowStore.Create(
			fio.WorkflowTemplateMetadata{ID: req.ID, Name: req.Name, Description: req.Description, Tags: req.Tags, CreatedBy: req.CreatedBy},
			fio.WorkflowTemplateVersion{CreatedBy: req.CreatedBy, SchemaVersion: req.SchemaVersion, Workflow: req.Workflow, ChangeLog: "initial version"},
		)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(t)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleWorkflowVersions(w http.ResponseWriter, r *http.Request, id string, tail []string) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.workflowStore.ListVersions(id)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		json.NewEncoder(w).Encode(list)
	case http.MethodPost:
		var req publishWorkflowVersionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		v, err := s.workflowStore.PublishVersion(id, fio.WorkflowTemplateVersion{CreatedBy: req.CreatedBy, ChangeLog: req.ChangeLog, SchemaVersion: req.SchemaVersion, Workflow: req.Workflow})
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(v)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
