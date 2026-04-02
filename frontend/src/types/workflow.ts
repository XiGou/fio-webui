import type { FioTaskList, GlobalConfig, JobConfig } from '@/types/api'

export const WORKFLOW_NODE_TYPE = {
  FIO_JOB: 'fio.job',
  CONTROL_STONEWALL: 'control.stonewall',
  GROUP_PARALLEL: 'group.parallel',
  REPORT_MARKER: 'report.marker',
} as const

export type WorkflowNodeType = (typeof WORKFLOW_NODE_TYPE)[keyof typeof WORKFLOW_NODE_TYPE]

export type NodeConfigSchema = {
  'fio.job': {
    taskName?: string
    global?: GlobalConfig
    job: JobConfig
  }
  'control.stonewall': {
    enabled?: boolean
  }
  'group.parallel': {
    taskName?: string
    global?: GlobalConfig
    jobs: JobConfig[]
  }
  'report.marker': {
    label: string
  }
}

export interface WorkflowNode<T extends WorkflowNodeType = WorkflowNodeType> {
  id: string
  type: T
  label?: string
  config: NodeConfigSchema[T]
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
}

export interface WorkflowDefinition {
  version: 1
  name?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  entryNodeId?: string
}

export interface WorkflowMappingResult {
  taskList: FioTaskList
  warnings: string[]
}
