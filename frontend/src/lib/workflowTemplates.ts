import type { WorkflowTemplate, WorkflowTemplateMeta, WorkflowTemplateVersion } from '@/types/workflowTemplates'

export async function listWorkflowTemplates(): Promise<WorkflowTemplateMeta[]> {
  const res = await fetch('/api/workflows')
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function createWorkflowTemplate(payload: {
  id: string
  name: string
  description: string
  tags: string[]
  created_by: string
  workflow: unknown
  schema_version: number
}): Promise<WorkflowTemplate> {
  const res = await fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function getWorkflowTemplate(id: string): Promise<WorkflowTemplate> {
  const res = await fetch(`/api/workflows/${id}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function publishWorkflowTemplateVersion(
  id: string,
  payload: { created_by: string; change_log: string; schema_version: number; workflow: unknown }
): Promise<WorkflowTemplateVersion> {
  const res = await fetch(`/api/workflows/${id}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
