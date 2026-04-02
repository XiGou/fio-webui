import type { FioTaskList, RunRecord } from '@/types/api'

export type RunRecordExt = RunRecord & {
  tags?: string[]
  template_source?: string
  template_name?: string
}

export type RunDetail = { meta: RunRecordExt; config: FioTaskList | null }

export type HistoryFilterState = {
  search: string
  status: 'all' | 'finished' | 'running' | 'error' | 'idle'
  timeRange: 'all' | '24h' | '7d' | '30d'
  tag: string
  templateSource: string
}

export type HistoryAction = 'rerun' | 'restore-workflow' | 'duplicate' | 'save-template' | 'export-report' | 'delete'
