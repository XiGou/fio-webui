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
  stonewallAfter?: boolean // If true, insert stonewall after this job
  runtime?: number // Override global runtime for this job
  ioengine?: string // Override global ioengine for this job
  nodeId?: string // Source workflow node id for traceability
}

export interface FioConfig {
  global: GlobalConfig
  jobs: JobConfig[]
  sequential?: boolean // If true, run jobs sequentially. If false, run in parallel.
}

// A FioTask represents a complete fio command configuration
export interface FioTask {
  name: string
  global: GlobalConfig
  jobs: JobConfig[]
}

// Multiple tasks to run sequentially
export interface FioTaskList {
  tasks: FioTask[]
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

export interface ValidationError {
  field: string
  message: string
}

export interface TaskValidationResponse {
  valid: boolean
  errors?: ValidationError[]
  warnings?: ValidationError[]
}

// Status update from fio --status-interval
export interface Latency {
  percentile: number
  value: number // nanoseconds or microseconds
}

export interface IOStats {
  iops: number
  bw: number // bytes/sec
  runtime: number // milliseconds
  iostats?: Array<{ name: string; value: number }>
  latency_ns?: Latency[]
  latency_us?: Latency[]
}

export interface JobStatus {
  jobname: string
  groupid: number
  error: number
  eta: number
  elapsed: number
  read: IOStats
  write: IOStats
  trim?: IOStats
  sync?: IOStats
}

export interface StatusUpdate {
  time: number // Unix timestamp (seconds)
  jobs: JobStatus[]
  errors?: Record<string, unknown>
}

// Run history types
export interface RunSummary {
  iops: number
  iops_read: number
  iops_write: number
  bw: number
  bw_read: number
  bw_write: number
  lat_mean: number
  lat_p50: number
  lat_p95: number
  lat_p99: number
}

export interface RunRecord {
  id: string
  status: string
  start_time: string
  end_time?: string
  error?: string
  disk_bytes: number
  summary?: RunSummary
}

export interface LogSummary {
  summary: string
  errors: string[]
}

// Data point for charting
export interface StatsDataPoint {
  time: number // Unix timestamp (seconds)
  iops: number
  iopsRead: number
  iopsWrite: number
  bw: number // MB/s
  bwRead: number // MB/s
  bwWrite: number // MB/s
  latMean: number // ms
  latP95: number // ms
  latP99: number // ms
  latMax: number // ms
}
