import type { FioOptionValue } from '@/types/api'

export type StageMode = 'sequential' | 'parallel'
export type FioParameterMap = Record<string, FioOptionValue>

export interface ExperimentJob {
  id: string
  name: string
  overrides: FioParameterMap
}

export interface ExperimentStage {
  id: string
  name: string
  mode: StageMode
  shared: FioParameterMap
  jobs: ExperimentJob[]
}

export interface Experiment {
  id: string
  name: string
  description?: string
  global: FioParameterMap
  stages: ExperimentStage[]
}
