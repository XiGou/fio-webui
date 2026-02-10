export interface OptionsResponse {
  io_engines: string[]
  rw_types: string[]
  devices: string[]
}

export interface GlobalConfig {
  ioengine: string
  direct: boolean
  runtime: number
  time_based?: boolean
  group_reporting?: boolean
  log_avg_msec: number
  status_interval?: number
  output_format?: string
}

export interface JobConfig {
  name: string
  filename: string
  rw: string
  bs: string
  size: string
  numjobs: number
  iodepth: number
  rwmixread: number
  rate?: string
}

export interface FioConfig {
  global: GlobalConfig
  jobs: JobConfig[]
  sequential?: boolean // If true, run jobs sequentially. If false, run in parallel.
}

export type RunStatus = 'idle' | 'running' | 'finished' | 'error'

export interface RunState {
  id: string
  status: RunStatus
  start_time: string
  end_time?: string
  error?: string
  output?: string
}

export interface DefaultsResponse {
  global: GlobalConfig
  job: JobConfig
}

export type WsMessageType = 'connected' | 'status' | 'output' | 'stats'

export interface WsMessage<T = unknown> {
  type: WsMessageType
  data: T
}
