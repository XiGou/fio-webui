export interface WorkflowTemplateMeta {
  id: string
  name: string
  description: string
  tags: string[]
  version: number
  created_by: string
  created_at: string
  updated_at: string
}

export interface WorkflowTemplateVersion {
  template_id: string
  version: number
  schema_version: number
  created_by: string
  created_at: string
  change_log?: string
  migration_hint?: string
  auto_migration_script?: string
  workflow: unknown
}

export interface WorkflowTemplate {
  metadata: WorkflowTemplateMeta
  latest: WorkflowTemplateVersion
}
