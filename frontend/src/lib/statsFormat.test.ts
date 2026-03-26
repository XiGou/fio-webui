import { describe, expect, it } from 'vitest'
import { describeMetricPresentation, filterStatsByTimeRange, formatMetricValue } from './statsFormat'
import type { StatsDataPoint } from '@/types/api'

const point = (time: number, patch: Partial<StatsDataPoint> = {}): StatsDataPoint => ({
  time,
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
  ...patch,
})

describe('filterStatsByTimeRange', () => {
  it('filters relative to the tail sample instead of wall clock time', () => {
    const points = [
      point(100),
      point(500),
      point(1_200),
    ]

    expect(filterStatsByTimeRange(points, '15m').map((item) => item.time)).toEqual([500, 1_200])
  })
})

describe('describeMetricPresentation', () => {
  it('uses GiB/s for large bandwidth series', () => {
    const presentation = describeMetricPresentation('bw', [128, 2048])

    expect(presentation.axisLabel).toBe('GiB/s')
    expect(presentation.transform(1536)).toBeCloseTo(1.5)
  })

  it('uses microseconds for sub-millisecond latency series', () => {
    const presentation = describeMetricPresentation('lat', [0.05, 0.4])

    expect(presentation.axisLabel).toBe('us')
    expect(presentation.transform(0.25)).toBeCloseTo(250)
  })
})

describe('formatMetricValue', () => {
  it('formats scaled IOPS values with compact units', () => {
    expect(formatMetricValue('iops', 15_500)).toBe('15.5 KIOPS')
  })
})
