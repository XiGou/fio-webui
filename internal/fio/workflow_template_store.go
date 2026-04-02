package fio

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const CurrentNodeSchemaVersion = 2

type WorkflowCompatibility struct {
	FromSchemaVersion int      `json:"from_schema_version"`
	ToSchemaVersion   int      `json:"to_schema_version"`
	AutoMigrated      bool     `json:"auto_migrated"`
	Hints             []string `json:"hints,omitempty"`
}

type WorkflowTemplateVersion struct {
	Version           int                    `json:"version"`
	TaskList          FioTaskList            `json:"task_list"`
	Workflow          *WorkflowDefinition    `json:"workflow,omitempty"`
	PublishedBy       string                 `json:"published_by,omitempty"`
	PublishedAt       string                 `json:"published_at"`
	NodeSchemaVersion int                    `json:"node_schema_version"`
	Compatibility     *WorkflowCompatibility `json:"compatibility,omitempty"`
}

type WorkflowTemplate struct {
	ID             string                    `json:"id"`
	Name           string                    `json:"name"`
	Description    string                    `json:"description"`
	Tags           []string                  `json:"tags,omitempty"`
	CreatedBy      string                    `json:"created_by"`
	CreatedAt      string                    `json:"created_at"`
	UpdatedAt      string                    `json:"updated_at"`
	CurrentVersion int                       `json:"current_version"`
	Versions       []WorkflowTemplateVersion `json:"versions"`
}

type WorkflowTemplateSummary struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Tags           []string `json:"tags,omitempty"`
	CreatedBy      string   `json:"created_by"`
	UpdatedAt      string   `json:"updated_at"`
	CurrentVersion int      `json:"current_version"`
}

type WorkflowCreateRequest struct {
	ID          string              `json:"id,omitempty"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Tags        []string            `json:"tags,omitempty"`
	CreatedBy   string              `json:"created_by,omitempty"`
	TaskList    FioTaskList         `json:"task_list"`
	Workflow    *WorkflowDefinition `json:"workflow,omitempty"`
}

type WorkflowUpdateRequest struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tags        []string `json:"tags,omitempty"`
}

type WorkflowPublishVersionRequest struct {
	PublishedBy string              `json:"published_by,omitempty"`
	TaskList    FioTaskList         `json:"task_list"`
	Workflow    *WorkflowDefinition `json:"workflow,omitempty"`
}

type WorkflowStore struct {
	baseDir string
}

func NewWorkflowStore(baseDir string) (*WorkflowStore, error) {
	dir := filepath.Join(baseDir, "workflows")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	s := &WorkflowStore{baseDir: dir}
	if err := s.ensureSeedTemplates(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *WorkflowStore) List() ([]WorkflowTemplateSummary, error) {
	entries, err := os.ReadDir(s.baseDir)
	if err != nil {
		return nil, err
	}
	items := make([]WorkflowTemplateSummary, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		wf, err := s.read(strings.TrimSuffix(entry.Name(), ".json"))
		if err != nil {
			continue
		}
		items = append(items, WorkflowTemplateSummary{ID: wf.ID, Name: wf.Name, Description: wf.Description, Tags: wf.Tags, CreatedBy: wf.CreatedBy, UpdatedAt: wf.UpdatedAt, CurrentVersion: wf.CurrentVersion})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt > items[j].UpdatedAt })
	return items, nil
}

func (s *WorkflowStore) Get(id string) (*WorkflowTemplate, error) { return s.read(id) }

func (s *WorkflowStore) Create(req WorkflowCreateRequest) (*WorkflowTemplate, error) {
	if strings.TrimSpace(req.Name) == "" {
		return nil, errors.New("name is required")
	}
	if len(req.TaskList.Tasks) == 0 {
		return nil, errors.New("task_list is required")
	}
	id := strings.TrimSpace(req.ID)
	if id == "" {
		id = "wf-" + strings.ToLower(strings.ReplaceAll(strconvTimeID(), "_", "-"))
	}
	if _, err := s.read(id); err == nil {
		return nil, fmt.Errorf("workflow %s already exists", id)
	}
	now := time.Now().Format(time.RFC3339)
	createdBy := req.CreatedBy
	if createdBy == "" {
		createdBy = "studio-user"
	}
	version := WorkflowTemplateVersion{Version: 1, TaskList: req.TaskList, Workflow: req.Workflow, PublishedBy: createdBy, PublishedAt: now, NodeSchemaVersion: CurrentNodeSchemaVersion}
	wf := &WorkflowTemplate{ID: id, Name: req.Name, Description: req.Description, Tags: req.Tags, CreatedBy: createdBy, CreatedAt: now, UpdatedAt: now, CurrentVersion: 1, Versions: []WorkflowTemplateVersion{version}}
	if err := s.write(wf); err != nil {
		return nil, err
	}
	return wf, nil
}

func (s *WorkflowStore) Update(id string, req WorkflowUpdateRequest) (*WorkflowTemplate, error) {
	wf, err := s.read(id)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.Name) != "" {
		wf.Name = req.Name
	}
	wf.Description = req.Description
	wf.Tags = req.Tags
	wf.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := s.write(wf); err != nil {
		return nil, err
	}
	return wf, nil
}

func (s *WorkflowStore) Delete(id string) error {
	path := filepath.Join(s.baseDir, id+".json")
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("workflow %s not found", id)
		}
		return err
	}
	return nil
}

func (s *WorkflowStore) PublishVersion(id string, req WorkflowPublishVersionRequest) (*WorkflowTemplateVersion, error) {
	if len(req.TaskList.Tasks) == 0 {
		return nil, errors.New("task_list is required")
	}
	wf, err := s.read(id)
	if err != nil {
		return nil, err
	}
	now := time.Now().Format(time.RFC3339)
	publishedBy := req.PublishedBy
	if publishedBy == "" {
		publishedBy = "studio-user"
	}
	compat := inferCompatibility(latestSchemaVersion(wf), CurrentNodeSchemaVersion)
	ver := WorkflowTemplateVersion{Version: wf.CurrentVersion + 1, TaskList: req.TaskList, Workflow: req.Workflow, PublishedBy: publishedBy, PublishedAt: now, NodeSchemaVersion: CurrentNodeSchemaVersion, Compatibility: compat}
	wf.Versions = append(wf.Versions, ver)
	wf.CurrentVersion = ver.Version
	wf.UpdatedAt = now
	if err := s.write(wf); err != nil {
		return nil, err
	}
	return &ver, nil
}

func (s *WorkflowStore) Versions(id string) ([]WorkflowTemplateVersion, error) {
	wf, err := s.read(id)
	if err != nil {
		return nil, err
	}
	return wf.Versions, nil
}

func latestSchemaVersion(wf *WorkflowTemplate) int {
	if len(wf.Versions) == 0 {
		return CurrentNodeSchemaVersion
	}
	return wf.Versions[len(wf.Versions)-1].NodeSchemaVersion
}

func inferCompatibility(from, to int) *WorkflowCompatibility {
	if from >= to {
		return nil
	}
	return &WorkflowCompatibility{FromSchemaVersion: from, ToSchemaVersion: to, AutoMigrated: true, Hints: []string{"检测到节点 schema 升级，已自动补齐默认字段。", "建议在 Studio 中检查 ioengine、runtime 等关键参数后重新发布版本。"}}
}

func (s *WorkflowStore) read(id string) (*WorkflowTemplate, error) {
	path := filepath.Join(s.baseDir, id+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("workflow %s not found", id)
		}
		return nil, err
	}
	var wf WorkflowTemplate
	if err := json.Unmarshal(data, &wf); err != nil {
		return nil, err
	}
	return &wf, nil
}

func (s *WorkflowStore) write(wf *WorkflowTemplate) error {
	path := filepath.Join(s.baseDir, wf.ID+".json")
	data, err := json.MarshalIndent(wf, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func (s *WorkflowStore) ensureSeedTemplates() error {
	items, err := s.List()
	if err != nil {
		return err
	}
	if len(items) > 0 {
		return nil
	}
	for _, seed := range defaultWorkflowSeeds() {
		if _, err := s.Create(seed); err != nil {
			return err
		}
	}
	return nil
}

func strconvTimeID() string { return fmt.Sprintf("%d", time.Now().UnixNano()) }

func defaultWorkflowSeeds() []WorkflowCreateRequest {
	g := DefaultGlobalConfig()
	return []WorkflowCreateRequest{
		{Name: "随机读写-4K", Description: "系统模板：4K 随机读写混合压测", Tags: []string{"系统", "随机", "混合"}, CreatedBy: "system", TaskList: FioTaskList{Tasks: []FioTask{{Name: "randrw-4k", Global: g, Jobs: []JobConfig{{Name: "randrw", Filename: "/tmp/fio-test", RW: RWRandRW, BS: "4k", Size: "1G", NumJobs: 4, IODepth: 32, RWMixRead: 70}}}}}},
		{Name: "顺序读写-1M", Description: "系统模板：顺序读写吞吐压测", Tags: []string{"系统", "顺序", "吞吐"}, CreatedBy: "system", TaskList: FioTaskList{Tasks: []FioTask{{Name: "seq-rw", Global: g, Jobs: []JobConfig{{Name: "seqread", Filename: "/tmp/fio-test", RW: RWRead, BS: "1m", Size: "4G", NumJobs: 1, IODepth: 8, RWMixRead: 70}, {Name: "seqwrite", Filename: "/tmp/fio-test", RW: RWWrite, BS: "1m", Size: "4G", NumJobs: 1, IODepth: 8, RWMixRead: 70, StonewallAfter: true}}}}}},
		{Name: "混合负载-数据库70/30", Description: "系统模板：数据库类随机混合负载", Tags: []string{"系统", "数据库", "70/30"}, CreatedBy: "system", TaskList: FioTaskList{Tasks: []FioTask{{Name: "db-mixed", Global: g, Jobs: []JobConfig{{Name: "db-mix", Filename: "/tmp/fio-test", RW: RWRandRW, BS: "8k", Size: "2G", NumJobs: 8, IODepth: 32, RWMixRead: 70}}}}}},
	}
}
