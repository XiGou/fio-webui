import { describe, expect, it } from 'vitest'
import type { JobStatsDataPoint, ReportJobSeries, ReportSeriesPoint, ReportSummary, StatsDataPoint } from '@/types/api'
import { buildLiveMetricSeries, buildReportMetricSeries, getLiveMetricJobs, getReportMetricJobs } from './metricSeries'

const jobPoint = (key: string, name: string, patch: Partial<JobStatsDataPoint> = {}): JobStatsDataPoint => ({
  key,
  name,
  stageIndex: 0,
  iops: 0,
  iopsRead: 0,
  iopsWrite: 0,
  bw: 0,
  bwRead: 0,
  bwWrite: 0,
  latMean: 0,
  latP95: 0,
  latP99: 0,
  latMax: 0,
  latMeanRead: 0,
  latP95Read: 0,
  latP99Read: 0,
  latMaxRead: 0,
  latMeanWrite: 0,
  latP95Write: 0,
  latP99Write: 0,
  latMaxWrite: 0,
  ...patch,
})

const livePoint = (time: number, jobs: JobStatsDataPoint[]): StatsDataPoint => ({
  time,
  stageIndex: 0,
  iops: 0,
  iopsRead: 0,
  iopsWrite: 0,
  bw: 0,
  bwRead: 0,
  bwWrite: 0,
  latMean: 0,
  latP95: 0,
  latP99: 0,
  latMax: 0,
  latMeanRead: 0,
  latP95Read: 0,
  latP99Read: 0,
  latMaxRead: 0,
  latMeanWrite: 0,
  latP95Write: 0,
  latP99Write: 0,
  latMaxWrite: 0,
  jobs,
})

const reportPoint = (time: number, patch: Partial<ReportSeriesPoint> = {}): ReportSeriesPoint => ({
  time,
  stage_index: 0,
  iops: 0,
  iopsRead: 0,
  iopsWrite: 0,
  bw: 0,
  bwRead: 0,
  bwWrite: 0,
  latMean: 0,
  latP99: 0,
  latMax: 0,
  latMeanRead: 0,
  latP99Read: 0,
  latMaxRead: 0,
  latMeanWrite: 0,
  latP99Write: 0,
  latMaxWrite: 0,
  ...patch,
})

const emptySummary = {} as ReportSummary

describe('buildLiveMetricSeries', () => {
  it('builds independent read and write lines for every selected Job', () => {
    const data = [livePoint(1, [
      jobPoint('0:read-4k', 'read-4k', { iopsRead: 100, iopsWrite: 10 }),
      jobPoint('0:mixed-128k', 'mixed-128k', { iopsRead: 40, iopsWrite: 60 }),
    ])]
    const jobs = getLiveMetricJobs(data)

    const series = buildLiveMetricSeries(data, 'iops', jobs, jobs.map((job) => job.key), ['read', 'write'], ['mean'])

    expect(series.map((item) => item.label)).toEqual([
      'OP 01 · read-4k · 读',
      'OP 01 · read-4k · 写',
      'OP 01 · mixed-128k · 读',
      'OP 01 · mixed-128k · 写',
    ])
    expect(series.map((item) => item.values)).toEqual([[100], [10], [40], [60]])
  })
})

describe('buildReportMetricSeries', () => {
  it('keeps per-Job directional latency aligned to the shared timeline', () => {
    const aggregate = [reportPoint(1), reportPoint(2)]
    const jobSeries: ReportJobSeries[] = [{
      key: '0:mixed',
      name: 'mixed',
      stage_index: 0,
      stage_name: '预热',
      job_index: 0,
      summary: emptySummary,
      points: [reportPoint(2, { latP99Read: 1.25, latP99Write: 3.5 })],
    }]
    const jobs = getReportMetricJobs(jobSeries)

    const result = buildReportMetricSeries(aggregate, jobSeries, 'lat', jobs, ['0:mixed'], ['read', 'write'], ['p99'])

    expect(result.times).toEqual([1, 2])
    expect(result.definitions.map((item) => item.label)).toEqual([
      'OP 01 · mixed · 读 P99',
      'OP 01 · mixed · 写 P99',
    ])
    expect(result.definitions.map((item) => item.values)).toEqual([[null, 1.25], [null, 3.5]])
  })
})
