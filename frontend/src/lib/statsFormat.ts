import type { StatsDataPoint } from '@/types/api'

export type StatsMetricType = 'iops' | 'bw' | 'lat'
export type StatsTimeRange = 'all' | '15m' | '1h' | '6h' | '24h'

type MetricPresentation = {
  axisLabel: string
  unit: string
  transform: (value: number) => number
}

const RANGE_SECONDS: Record<Exclude<StatsTimeRange, 'all'>, number> = {
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
}

function compact(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0)
  if (Math.abs(value) >= 10) return value.toFixed(1)
  return value.toFixed(2).replace(/\.?0+$/, '')
}

export function formatPresentationValue(presentation: MetricPresentation, value: number): string {
  return `${compact(presentation.transform(value))} ${presentation.unit}`
}

export function filterStatsByTimeRange(points: StatsDataPoint[], range: StatsTimeRange): StatsDataPoint[] {
  if (range === 'all' || points.length === 0) {
    return points
  }
  const tail = points[points.length - 1]?.time ?? 0
  const threshold = tail - RANGE_SECONDS[range]
  return points.filter((point) => point.time >= threshold)
}

export function describeMetricPresentation(type: StatsMetricType, values: number[]): MetricPresentation {
  const max = values.reduce((peak, value) => Math.max(peak, value), 0)

  if (type === 'bw') {
    if (max >= 1024) {
      return {
        axisLabel: 'GiB/s',
        unit: 'GiB/s',
        transform: (value) => value / 1024,
      }
    }
    return {
      axisLabel: 'MiB/s',
      unit: 'MiB/s',
      transform: (value) => value,
    }
  }

  if (type === 'lat') {
    if (max >= 1000) {
      return {
        axisLabel: 's',
        unit: 's',
        transform: (value) => value / 1000,
      }
    }
    if (max > 0 && max < 1) {
      return {
        axisLabel: 'us',
        unit: 'us',
        transform: (value) => value * 1000,
      }
    }
    return {
      axisLabel: 'ms',
      unit: 'ms',
      transform: (value) => value,
    }
  }

  if (max >= 1_000_000) {
    return {
      axisLabel: 'MIOPS',
      unit: 'MIOPS',
      transform: (value) => value / 1_000_000,
    }
  }
  if (max >= 1_000) {
    return {
      axisLabel: 'KIOPS',
      unit: 'KIOPS',
      transform: (value) => value / 1_000,
    }
  }
  return {
    axisLabel: 'IOPS',
    unit: 'IOPS',
    transform: (value) => value,
  }
}

export function formatMetricValue(type: StatsMetricType, value: number): string {
  const presentation = describeMetricPresentation(type, [value])
  return formatPresentationValue(presentation, value)
}
