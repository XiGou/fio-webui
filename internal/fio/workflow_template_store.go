package fio

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const CurrentWorkflowSchemaVersion = 2

type WorkflowTemplateMetadata struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Version     int      `json:"version"`
	CreatedBy   string   `json:"created_by"`
	CreatedAt   string   `json:"created_at"`
	UpdatedAt   string   `json:"updated_at"`
}

type WorkflowTemplateVersion struct {
	TemplateID          string          `json:"template_id"`
	Version             int             `json:"version"`
	SchemaVersion       int             `json:"schema_version"`
	CreatedBy           string          `json:"created_by"`
	CreatedAt           string          `json:"created_at"`
	ChangeLog           string          `json:"change_log,omitempty"`
	MigrationHint       string          `json:"migration_hint,omitempty"`
	AutoMigrationScript string          `json:"auto_migration_script,omitempty"`
	Workflow            json.RawMessage `json:"workflow"`
}

type WorkflowTemplate struct {
	Metadata WorkflowTemplateMetadata `json:"metadata"`
	Latest   WorkflowTemplateVersion  `json:"latest"`
}

type WorkflowTemplateStore struct {
	rootDir string
}

func NewWorkflowTemplateStore(dataDir string) (*WorkflowTemplateStore, error) {
	root := filepath.Join(dataDir, "workflows")
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, err
	}
	s := &WorkflowTemplateStore{rootDir: root}
	if err := s.seedSystemTemplates(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *WorkflowTemplateStore) templateDir(id string) string { return filepath.Join(s.rootDir, id) }
func (s *WorkflowTemplateStore) metaPath(id string) string {
	return filepath.Join(s.templateDir(id), "meta.json")
}
func (s *WorkflowTemplateStore) versionPath(id string, v int) string {
	return filepath.Join(s.templateDir(id), "versions", fmt.Sprintf("v%d.json", v))
}

func (s *WorkflowTemplateStore) List() ([]WorkflowTemplateMetadata, error) {
	entries, err := os.ReadDir(s.rootDir)
	if err != nil {
		return nil, err
	}
	items := make([]WorkflowTemplateMetadata, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		meta, err := s.loadMeta(e.Name())
		if err != nil {
			continue
		}
		items = append(items, *meta)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt > items[j].UpdatedAt })
	return items, nil
}

func (s *WorkflowTemplateStore) Get(id string) (*WorkflowTemplate, error) {
	meta, err := s.loadMeta(id)
	if err != nil {
		return nil, err
	}
	ver, err := s.GetVersion(id, meta.Version)
	if err != nil {
		return nil, err
	}
	return &WorkflowTemplate{Metadata: *meta, Latest: *ver}, nil
}

func (s *WorkflowTemplateStore) Create(meta WorkflowTemplateMetadata, version WorkflowTemplateVersion) (*WorkflowTemplate, error) {
	if meta.ID == "" {
		return nil, errors.New("id is required")
	}
	now := time.Now().Format(time.RFC3339)
	meta.CreatedAt = now
	meta.UpdatedAt = now
	meta.Version = 1
	version.TemplateID = meta.ID
	version.Version = 1
	if version.SchemaVersion == 0 {
		version.SchemaVersion = CurrentWorkflowSchemaVersion
	}
	version.CreatedAt = now

	if err := os.MkdirAll(filepath.Join(s.templateDir(meta.ID), "versions"), 0o755); err != nil {
		return nil, err
	}
	if err := s.saveMeta(meta); err != nil {
		return nil, err
	}
	if err := s.saveVersion(version); err != nil {
		return nil, err
	}
	return s.Get(meta.ID)
}

func (s *WorkflowTemplateStore) UpdateMetadata(id string, patch WorkflowTemplateMetadata) (*WorkflowTemplateMetadata, error) {
	meta, err := s.loadMeta(id)
	if err != nil {
		return nil, err
	}
	if patch.Name != "" {
		meta.Name = patch.Name
	}
	meta.Description = patch.Description
	if patch.Tags != nil {
		meta.Tags = patch.Tags
	}
	meta.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := s.saveMeta(*meta); err != nil {
		return nil, err
	}
	return meta, nil
}

func (s *WorkflowTemplateStore) Delete(id string) error {
	if id == "" {
		return errors.New("id is required")
	}
	return os.RemoveAll(s.templateDir(id))
}

func (s *WorkflowTemplateStore) ListVersions(id string) ([]WorkflowTemplateVersion, error) {
	meta, err := s.loadMeta(id)
	if err != nil {
		return nil, err
	}
	res := make([]WorkflowTemplateVersion, 0, meta.Version)
	for i := 1; i <= meta.Version; i++ {
		v, err := s.GetVersion(id, i)
		if err == nil {
			res = append(res, *v)
		}
	}
	return res, nil
}

func (s *WorkflowTemplateStore) GetVersion(id string, version int) (*WorkflowTemplateVersion, error) {
	b, err := os.ReadFile(s.versionPath(id, version))
	if err != nil {
		return nil, err
	}
	var v WorkflowTemplateVersion
	if err := json.Unmarshal(b, &v); err != nil {
		return nil, err
	}
	return &v, nil
}

func (s *WorkflowTemplateStore) PublishVersion(id string, version WorkflowTemplateVersion) (*WorkflowTemplateVersion, error) {
	meta, err := s.loadMeta(id)
	if err != nil {
		return nil, err
	}
	meta.Version++
	meta.UpdatedAt = time.Now().Format(time.RFC3339)
	version.TemplateID = id
	version.Version = meta.Version
	if version.SchemaVersion == 0 {
		version.SchemaVersion = CurrentWorkflowSchemaVersion
	}
	version.CreatedAt = meta.UpdatedAt
	if version.SchemaVersion < CurrentWorkflowSchemaVersion {
		version.MigrationHint = fmt.Sprintf("模板 schema(v%d) 低于当前版本(v%d)，建议执行迁移脚本。", version.SchemaVersion, CurrentWorkflowSchemaVersion)
		version.AutoMigrationScript = "migrateWorkflowSchemaV1ToV2"
	}
	if err := s.saveVersion(version); err != nil {
		return nil, err
	}
	if err := s.saveMeta(*meta); err != nil {
		return nil, err
	}
	return &version, nil
}

func (s *WorkflowTemplateStore) loadMeta(id string) (*WorkflowTemplateMetadata, error) {
	b, err := os.ReadFile(s.metaPath(id))
	if err != nil {
		return nil, err
	}
	var m WorkflowTemplateMetadata
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

func (s *WorkflowTemplateStore) saveMeta(meta WorkflowTemplateMetadata) error {
	b, _ := json.MarshalIndent(meta, "", "  ")
	return os.WriteFile(s.metaPath(meta.ID), b, 0o644)
}

func (s *WorkflowTemplateStore) saveVersion(v WorkflowTemplateVersion) error {
	if err := os.MkdirAll(filepath.Join(s.templateDir(v.TemplateID), "versions"), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(v, "", "  ")
	return os.WriteFile(s.versionPath(v.TemplateID, v.Version), b, 0o644)
}

func (s *WorkflowTemplateStore) seedSystemTemplates() error {
	items, err := s.List()
	if err != nil {
		return err
	}
	if len(items) > 0 {
		return nil
	}
	type seed struct {
		id, name, desc string
		tags           []string
		workflow       string
	}
	seeds := []seed{
		{"system-rand-rw", "随机读写（4k）", "系统种子模板：随机读与随机写组合", []string{"system", "random", "seed"}, `{"schemaVersion":2,"nodes":[{"id":"start-1","type":"start","position":{"x":80,"y":80},"data":{"label":"Start"}},{"id":"job-randread","type":"fioJob","position":{"x":340,"y":80},"data":{"label":"随机读","rw":"randread","bs":"4k","iodepth":32}},{"id":"job-randwrite","type":"fioJob","position":{"x":620,"y":80},"data":{"label":"随机写","rw":"randwrite","bs":"4k","iodepth":32}},{"id":"end-1","type":"end","position":{"x":900,"y":80},"data":{"label":"End"}}],"edges":[{"id":"e1","source":"start-1","target":"job-randread"},{"id":"e2","source":"job-randread","target":"job-randwrite"},{"id":"e3","source":"job-randwrite","target":"end-1"}]}`},
		{"system-seq-rw", "顺序读写（128k）", "系统种子模板：顺序读写吞吐场景", []string{"system", "sequential", "seed"}, `{"schemaVersion":2,"nodes":[{"id":"start-1","type":"start","position":{"x":80,"y":80},"data":{"label":"Start"}},{"id":"job-read","type":"fioJob","position":{"x":340,"y":80},"data":{"label":"顺序读","rw":"read","bs":"128k","iodepth":16}},{"id":"job-write","type":"fioJob","position":{"x":620,"y":80},"data":{"label":"顺序写","rw":"write","bs":"128k","iodepth":16}},{"id":"end-1","type":"end","position":{"x":900,"y":80},"data":{"label":"End"}}],"edges":[{"id":"e1","source":"start-1","target":"job-read"},{"id":"e2","source":"job-read","target":"job-write"},{"id":"e3","source":"job-write","target":"end-1"}]}`},
		{"system-mixed-70-30", "混合负载（70/30）", "系统种子模板：数据库常见混合读写", []string{"system", "mixed", "seed"}, `{"schemaVersion":2,"nodes":[{"id":"start-1","type":"start","position":{"x":80,"y":80},"data":{"label":"Start"}},{"id":"job-mix","type":"fioJob","position":{"x":360,"y":80},"data":{"label":"混合读写 70/30","rw":"randrw","rwmixread":70,"bs":"8k","iodepth":32}},{"id":"end-1","type":"end","position":{"x":680,"y":80},"data":{"label":"End"}}],"edges":[{"id":"e1","source":"start-1","target":"job-mix"},{"id":"e2","source":"job-mix","target":"end-1"}]}`},
	}
	for _, x := range seeds {
		id := sanitizeTemplateID(x.id)
		_, err := s.Create(WorkflowTemplateMetadata{ID: id, Name: x.name, Description: x.desc, Tags: x.tags, CreatedBy: "system"}, WorkflowTemplateVersion{CreatedBy: "system", ChangeLog: "seed", SchemaVersion: CurrentWorkflowSchemaVersion, Workflow: json.RawMessage(x.workflow)})
		if err != nil {
			return err
		}
	}
	return nil
}

func sanitizeTemplateID(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return "tpl-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	s = strings.ReplaceAll(s, " ", "-")
	return s
}
