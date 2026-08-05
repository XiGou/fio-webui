export type FioOptionValue = string | number | boolean

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
  extra_options?: Record<string, FioOptionValue>
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
export interface JobStatsDataPoint {
  key: string
  name: string
  stageIndex: number
  iops: number
  iopsRead: number
  iopsWrite: number
  bw: number
  bwRead: number
  bwWrite: number
  latMean: number
  latP95: number
  latP99: number
  latMax: number
  latMeanRead: number
  latP95Read: number
  latP99Read: number
  latMaxRead: number
  latMeanWrite: number
  latP95Write: number
  latP99Write: number
  latMaxWrite: number
}

export interface StatsDataPoint {
  time: number // Unix timestamp (seconds)
  stageIndex: number
  iops: number
  iopsRead: number
  iopsWrite: number
  bw: number // MiB/s
  bwRead: number // MiB/s
  bwWrite: number // MiB/s
  latMean: number // ms
  latP95: number // ms
  latP99: number // ms
  latMax: number // ms
  latMeanRead: number
  latP95Read: number
  latP99Read: number
  latMaxRead: number
  latMeanWrite: number
  latP95Write: number
  latP99Write: number
  latMaxWrite: number
  jobs?: JobStatsDataPoint[]
}

export interface ReportSeriesPoint {
  time: number // elapsed seconds across all ordered nodes
  stage_index: number
  iops: number
  iopsRead: number
  iopsWrite: number
  bw: number // MiB/s
  bwRead: number
  bwWrite: number
  latMean: number // ms
  latP99: number
  latMax: number
  latMeanRead: number
  latP99Read: number
  latMaxRead: number
  latMeanWrite: number
  latP99Write: number
  latMaxWrite: number
}

export interface ReportJobSeries {
  key: string
  name: string
  stage_index: number
  stage_name: string
  job_index: number
  points: ReportSeriesPoint[]
  summary: ReportSummary
}

export interface ReportStageBoundary {
  index: number
  name: string
  start_seconds: number
  end_seconds: number
  job_count: number
}

export interface ReportDataSource {
  kind: 'fio-task-logs' | 'stats-jsonl-fallback'
  files: string[]
  latency_mode: 'histogram' | 'histogram+window-fallback' | 'window-log-fallback' | 'status-percentiles' | 'unavailable'
  sample_interval_ms?: number
}

export interface ReportSummary {
  sample_count: number
  duration_seconds: number
  mean_iops: number
  peak_iops: number
  mean_iops_read: number
  peak_iops_read: number
  mean_iops_write: number
  peak_iops_write: number
  mean_bandwidth_mib: number
  peak_bandwidth_mib: number
  mean_bandwidth_read_mib: number
  peak_bandwidth_read_mib: number
  mean_bandwidth_write_mib: number
  peak_bandwidth_write_mib: number
  mean_latency_ms: number
  p99_latency_ms: number
  peak_latency_ms: number
  mean_latency_read_ms: number
  p99_latency_read_ms: number
  peak_latency_read_ms: number
  mean_latency_write_ms: number
  p99_latency_write_ms: number
  peak_latency_write_ms: number
}

export interface RunReportDTO {
  meta: RunRecord
  config: {
    task_list?: FioTaskList
    workflow?: unknown
    metadata?: Record<string, unknown>
  }
  stats: StatsDataPoint[]
  series: ReportSeriesPoint[]
  job_series: ReportJobSeries[]
  stages: ReportStageBoundary[]
  source: ReportDataSource
  summary: ReportSummary
  log_summary: LogSummary
  errors: string[]
  exported_at: string
}
