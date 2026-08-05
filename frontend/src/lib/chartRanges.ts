export const LIVE_TIME_WINDOW_SECONDS = {
  '30s': 30,
  '1m': 60,
  '5m': 300,
  '15m': 900,
  all: null,
} as const

export type LiveTimeWindow = keyof typeof LIVE_TIME_WINDOW_SECONDS

export const DEFAULT_LIVE_TIME_WINDOW: LiveTimeWindow = '1m'

export type ChartDomain = {
  min: number
  max: number
}

type TimedPoint = {
  time: number
}

type NumericSeries = ArrayLike<number | null | undefined>

export function getNormalizedTimeline(points: TimedPoint[]): number[] {
  if (points.length === 0) return []

  const timeline = [0]
  let previousRaw = Number(points[0]?.time) || 0
  let elapsed = 0
  let sampleStep = Number.POSITIVE_INFINITY

  for (let index = 1; index < points.length; index += 1) {
    const raw = Number(points[index]?.time)
    const currentRaw = Number.isFinite(raw) ? raw : previousRaw
    const delta = currentRaw - previousRaw
    if (delta > 0) {
      elapsed += delta
      sampleStep = Math.min(sampleStep, delta)
    } else if (delta < 0) {
      elapsed += Number.isFinite(sampleStep) ? sampleStep : 1
    } else {
      elapsed += Number.isFinite(sampleStep) ? Math.min(sampleStep / 1000, 0.001) : 0.001
    }
    timeline.push(elapsed)
    previousRaw = currentRaw
  }

  return timeline
}

export function getLiveChartDomain(points: TimedPoint[], window: LiveTimeWindow): ChartDomain {
  if (points.length === 0) return { min: 0, max: LIVE_TIME_WINDOW_SECONDS[window] ?? 1 }

  const elapsed = getNormalizedTimeline(points).at(-1) ?? 0
  const windowSeconds = LIVE_TIME_WINDOW_SECONDS[window]

  if (windowSeconds == null) return { min: 0, max: Math.max(1, elapsed) }

  return {
    min: elapsed - windowSeconds,
    max: elapsed,
  }
}

export function getVisibleYDomain(
  times: ArrayLike<number>,
  series: NumericSeries[],
  visible: boolean[],
  xDomain: ChartDomain,
): ChartDomain {
  let peak = 0

  series.forEach((values, seriesIndex) => {
    if (!visible[seriesIndex]) return
    const length = Math.min(times.length, values.length)
    for (let index = 0; index < length; index += 1) {
      const time = Number(times[index])
      const value = Number(values[index])
      if (!Number.isFinite(time) || time < xDomain.min || time > xDomain.max) continue
      if (Number.isFinite(value)) peak = Math.max(peak, value)
    }
  })

  return { min: 0, max: Math.max(1, peak * 1.08) }
}
