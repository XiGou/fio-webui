import type { JobStatsDataPoint, ReportJobSeries, ReportSeriesPoint, StatsDataPoint } from '@/types/api'

export type MetricType = 'iops' | 'bw' | 'lat'
export type MetricDirection = 'read' | 'write'
export type LatencyStatistic = 'mean' | 'p99' | 'max'

export type MetricJobOption = {
  key: string
  name: string
  stageIndex: number
  stageName?: string
}

export type MetricSeriesDefinition = {
  label: string
  color: string
  width: number
  dash?: number[]
  values: Array<number | null>
}

const AGGREGATE_KEY = '__aggregate__'
const JOB_COLORS = [
  { read: '#0b8198', write: '#c56b05' },
  { read: '#157a5b', write: '#b83232' },
  { read: '#3267a8', write: '#9a6718' },
  { read: '#5d6f3b', write: '#a14c68' },
  { read: '#536f8d', write: '#8a5d31' },
]

const LATENCY_DASH: Record<LatencyStatistic, number[] | undefined> = {
  mean: undefined,
  p99: [8, 4],
  max: [2, 4],
}

const DIRECTION_LABEL: Record<MetricDirection, string> = { read: '读', write: '写' }
const STAT_LABEL: Record<LatencyStatistic, string> = { mean: 'Mean', p99: 'P99', max: 'Max' }

export function getLiveMetricJobs(data: StatsDataPoint[]): MetricJobOption[] {
  const seen = new Set<string>()
  const jobs: MetricJobOption[] = []
  data.forEach((point) => point.jobs?.forEach((job) => {
    if (seen.has(job.key)) return
    seen.add(job.key)
    jobs.push({ key: job.key, name: job.name, stageIndex: job.stageIndex })
  }))
  return jobs.length ? jobs : [{ key: AGGREGATE_KEY, name: '全部 Job', stageIndex: -1 }]
}

export function getReportMetricJobs(jobSeries: ReportJobSeries[]): MetricJobOption[] {
  if (!jobSeries.length) return [{ key: AGGREGATE_KEY, name: '全部 Job', stageIndex: -1 }]
  return jobSeries.map((job) => ({ key: job.key, name: job.name, stageIndex: job.stage_index, stageName: job.stage_name }))
}

function jobLabel(job: MetricJobOption): string {
  return job.stageIndex >= 0 ? `OP ${String(job.stageIndex + 1).padStart(2, '0')} · ${job.name}` : job.name
}

function getLiveSource(point: StatsDataPoint, key: string): StatsDataPoint | JobStatsDataPoint | null {
  if (key === AGGREGATE_KEY) return point
  return point.jobs?.find((job) => job.key === key) ?? null
}

function throughputValue(source: StatsDataPoint | JobStatsDataPoint | ReportSeriesPoint, type: Exclude<MetricType, 'lat'>, direction: MetricDirection): number {
  if (type === 'iops') return direction === 'read' ? source.iopsRead : source.iopsWrite
  return direction === 'read' ? source.bwRead : source.bwWrite
}

function latencyValue(source: StatsDataPoint | JobStatsDataPoint, direction: MetricDirection, statistic: LatencyStatistic): number {
  if (direction === 'read') {
    if (statistic === 'mean') return source.latMeanRead
    if (statistic === 'p99') return source.latP99Read
    return source.latMaxRead
  }
  if (statistic === 'mean') return source.latMeanWrite
  if (statistic === 'p99') return source.latP99Write
  return source.latMaxWrite
}

function aggregateLatencyValue(source: StatsDataPoint | ReportSeriesPoint, statistic: LatencyStatistic): number {
  if (statistic === 'mean') return source.latMean
  if (statistic === 'p99') return source.latP99
  return source.latMax
}

export function buildLiveMetricSeries(
  data: StatsDataPoint[],
  type: MetricType,
  jobs: MetricJobOption[],
  selectedJobKeys: string[],
  directions: MetricDirection[],
  latencyStatistics: LatencyStatistic[],
): MetricSeriesDefinition[] {
  const selected = jobs.filter((job) => selectedJobKeys.includes(job.key))
  return selected.flatMap((job, jobIndex) => {
    const colors = JOB_COLORS[jobIndex % JOB_COLORS.length]
    if (type !== 'lat') {
      return directions.map((direction) => ({
        label: `${jobLabel(job)} · ${DIRECTION_LABEL[direction]}`,
        color: colors[direction],
        width: 1.8,
        dash: direction === 'write' ? [8, 4] : undefined,
        values: data.map((point) => {
          const source = getLiveSource(point, job.key)
          return source ? throughputValue(source, type, direction) : null
        }),
      }))
    }

    if (job.key === AGGREGATE_KEY && data.every((point) => !point.jobs?.length)) {
      return latencyStatistics.map((statistic) => ({
        label: `${jobLabel(job)} · ${STAT_LABEL[statistic]}`,
        color: colors.read,
        width: statistic === 'mean' ? 1.8 : 1.5,
        dash: LATENCY_DASH[statistic],
        values: data.map((point) => aggregateLatencyValue(point, statistic)),
      }))
    }

    return directions.flatMap((direction) => latencyStatistics.map((statistic) => ({
      label: `${jobLabel(job)} · ${DIRECTION_LABEL[direction]} ${STAT_LABEL[statistic]}`,
      color: colors[direction],
      width: statistic === 'mean' ? 1.8 : 1.5,
      dash: LATENCY_DASH[statistic],
      values: data.map((point) => {
        const source = getLiveSource(point, job.key)
        return source ? latencyValue(source, direction, statistic) : null
      }),
    })))
  })
}

function reportPointKey(time: number): string {
  return Number(time).toFixed(6)
}

export function buildReportMetricSeries(
  aggregate: ReportSeriesPoint[],
  jobSeries: ReportJobSeries[],
  type: MetricType,
  jobs: MetricJobOption[],
  selectedJobKeys: string[],
  directions: MetricDirection[],
  latencyStatistics: LatencyStatistic[],
): { times: number[]; definitions: MetricSeriesDefinition[] } {
  const times = aggregate.map((point) => point.time)
  const selected = jobs.filter((job) => selectedJobKeys.includes(job.key))
  const seriesByKey = new Map(jobSeries.map((series) => [series.key, series]))
  const definitions = selected.flatMap((job, jobIndex) => {
    const colors = JOB_COLORS[jobIndex % JOB_COLORS.length]
    const points = job.key === AGGREGATE_KEY ? aggregate : seriesByKey.get(job.key)?.points ?? []
    const byTime = new Map(points.map((point) => [reportPointKey(point.time), point]))
    const atTime = (time: number) => byTime.get(reportPointKey(time)) ?? null

    if (type !== 'lat') {
      return directions.map((direction) => ({
        label: `${jobLabel(job)} · ${DIRECTION_LABEL[direction]}`,
        color: colors[direction],
        width: 1.8,
        dash: direction === 'write' ? [8, 4] : undefined,
        values: times.map((time) => {
          const point = atTime(time)
          return point ? throughputValue(point, type, direction) : null
        }),
      }))
    }

    if (job.key === AGGREGATE_KEY) {
      return latencyStatistics.map((statistic) => ({
        label: `${jobLabel(job)} · ${STAT_LABEL[statistic]}`,
        color: colors.read,
        width: statistic === 'mean' ? 1.8 : 1.5,
        dash: LATENCY_DASH[statistic],
        values: times.map((time) => {
          const point = atTime(time)
          return point ? aggregateLatencyValue(point, statistic) : null
        }),
      }))
    }

    return directions.flatMap((direction) => latencyStatistics.map((statistic) => ({
      label: `${jobLabel(job)} · ${DIRECTION_LABEL[direction]} ${STAT_LABEL[statistic]}`,
      color: colors[direction],
      width: statistic === 'mean' ? 1.8 : 1.5,
      dash: LATENCY_DASH[statistic],
      values: times.map((time) => {
        const point = atTime(time)
        if (!point) return null
        if (direction === 'read') {
          if (statistic === 'mean') return point.latMeanRead
          if (statistic === 'p99') return point.latP99Read
          return point.latMaxRead
        }
        if (statistic === 'mean') return point.latMeanWrite
        if (statistic === 'p99') return point.latP99Write
        return point.latMaxWrite
      }),
    })))
  })
  return { times, definitions }
}
