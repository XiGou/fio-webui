import type { GlobalConfig } from '@/types/api'

export type StageMode = 'sequential' | 'parallel'

export interface ExperimentJob {
  id: string
  name: string
  filename: string
  rw: string
  bs: string
  size: string
  numjobs: number
  iodepth: number
  rwmixread: number
  rate?: string
  runtime?: number
  ioengine?: string
}

export interface ExperimentStage {
  id: string
  name: string
  mode: StageMode
  global?: Partial<GlobalConfig>
  jobs: ExperimentJob[]
}

export interface Experiment {
  id: string
  name: string
  description?: string
  global: GlobalConfig
  stages: ExperimentStage[]
}
