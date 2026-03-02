package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// GitHubStatusResponse represents GitHub's status page API response.
type GitHubStatusResponse struct {
	Status     GitHubStatus      `json:"status"`
	Components []GitHubComponent `json:"components"`
}

type GitHubStatus struct {
	Indicator   string `json:"indicator"`
	Description string `json:"description"`
}

type GitHubComponent struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	Status             string `json:"status"`
	UpdatedAt          string `json:"updated_at"`
	CreatedAt          string `json:"created_at"`
	PageID             string `json:"page_id"`
	GroupID            *string `json:"group_id"`
	Showcase           bool   `json:"showcase"`
	StartDate          *string `json:"start_date"`
	Description        *string `json:"description"`
	Position           int    `json:"position"`
	Group              bool   `json:"group"`
	OnlyShowIfDegraded bool   `json:"only_show_if_degraded"`
}

// WorkflowRun is a subset of GitHub's workflow run object.
type WorkflowRun struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Status      string    `json:"status"`
	Conclusion  *string   `json:"conclusion"`
	HTMLURL     string    `json:"html_url"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	RunNumber   int       `json:"run_number"`
	Actor       struct {
		Login string `json:"login"`
	} `json:"actor"`
	HeadBranch  string `json:"head_branch"`
	HeadSHA     string `json:"head_sha"`
	WorkflowID  int64  `json:"workflow_id"`
}

// GitHubActionsStatusResponse is the API response returned to the frontend.
type GitHubActionsStatusResponse struct {
	ServiceStatus *GitHubStatusResponse `json:"service_status"`
	QueuedRuns    []WorkflowRun         `json:"queued_runs"`
	InProgressRuns []WorkflowRun        `json:"in_progress_runs"`
	QueuedCount   int                   `json:"queued_count"`
	InProgressCount int                 `json:"in_progress_count"`
	Error         string                `json:"error,omitempty"`
}

func (s *Server) handleGitHubActionsStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	owner := r.URL.Query().Get("owner")
	repo := r.URL.Query().Get("repo")
	token := r.URL.Query().Get("token")

	resp := &GitHubActionsStatusResponse{}

	// Fetch GitHub service status
	svcStatus, err := fetchGitHubServiceStatus()
	if err != nil {
		resp.Error = fmt.Sprintf("failed to fetch GitHub service status: %v", err)
	} else {
		resp.ServiceStatus = svcStatus
	}

	// Fetch workflow runs if owner and repo are provided
	if owner != "" && repo != "" {
		queued, err := fetchWorkflowRuns(owner, repo, "queued", token)
		if err != nil && resp.Error == "" {
			resp.Error = fmt.Sprintf("failed to fetch queued runs: %v", err)
		} else {
			resp.QueuedRuns = queued
			resp.QueuedCount = len(queued)
		}

		inProgress, err := fetchWorkflowRuns(owner, repo, "in_progress", token)
		if err != nil && resp.Error == "" {
			resp.Error = fmt.Sprintf("failed to fetch in-progress runs: %v", err)
		} else {
			resp.InProgressRuns = inProgress
			resp.InProgressCount = len(inProgress)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func fetchGitHubServiceStatus() (*GitHubStatusResponse, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodGet, "https://www.githubstatus.com/api/v2/components.json", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "fio-webui/1.0")

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	var status GitHubStatusResponse
	if err := json.NewDecoder(res.Body).Decode(&status); err != nil {
		return nil, err
	}
	return &status, nil
}

func fetchWorkflowRuns(owner, repo, status, token string) ([]WorkflowRun, error) {
	client := &http.Client{Timeout: 15 * time.Second}
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/actions/runs?status=%s&per_page=100", owner, repo, status)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "fio-webui/1.0")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	if res.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("unauthorized: check your GitHub token")
	}
	if res.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("repository %s/%s not found or not accessible", owner, repo)
	}
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API returned status %d", res.StatusCode)
	}

	var payload struct {
		TotalCount   int           `json:"total_count"`
		WorkflowRuns []WorkflowRun `json:"workflow_runs"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return payload.WorkflowRuns, nil
}
