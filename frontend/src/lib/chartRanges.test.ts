import { describe, expect, it } from 'vitest'
import { DEFAULT_LIVE_TIME_WINDOW, getLiveChartDomain, getNormalizedTimeline, getVisibleYDomain } from './chartRanges'

describe('getNormalizedTimeline', () => {
  it('joins stage-local timestamps into one continuous timeline', () => {
    expect(getNormalizedTimeline([
      { time: 1 }, { time: 2 }, { time: 3 },
      { time: 1 }, { time: 2 }, { time: 3 },
    ])).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('preserves repeated samples instead of compressing them into milliseconds', () => {
    expect(getNormalizedTimeline([{ time: 1 }, { time: 2 }, { time: 2 }, { time: 3 }])).toEqual([0, 1, 1.001, 2.001])
  })
})

describe('getLiveChartDomain', () => {
  it('starts with the default one minute observation window', () => {
    expect(DEFAULT_LIVE_TIME_WINDOW).toBe('1m')
    expect(getLiveChartDomain([{ time: 10 }, { time: 30 }], '1m')).toEqual({ min: -40, max: 20 })
  })

  it('moves the window left edge as new samples extend past the range', () => {
    expect(getLiveChartDomain([{ time: 10 }, { time: 85 }], '1m')).toEqual({ min: 15, max: 75 })
  })

  it('keeps the complete timeline when all is selected', () => {
    expect(getLiveChartDomain([{ time: 10 }, { time: 85 }], 'all')).toEqual({ min: 0, max: 75 })
  })

  it('uses the complete multi-stage duration after timestamps reset', () => {
    const points = [
      { time: 1 }, { time: 2 }, { time: 3 },
      { time: 1 }, { time: 2 }, { time: 3 },
    ]
    expect(getLiveChartDomain(points, 'all')).toEqual({ min: 0, max: 5 })
  })
})

describe('getVisibleYDomain', () => {
  it('ignores hidden series and values outside the visible time domain', () => {
    const domain = getVisibleYDomain(
      [0, 1, 2],
      [[1000, 1000, 1000], [5, 10, 500]],
      [false, true],
      { min: 0, max: 1 },
    )

    expect(domain.min).toBe(0)
    expect(domain.max).toBeCloseTo(10.8)
  })

  it('uses a stable empty range when all series are hidden', () => {
    expect(getVisibleYDomain([0], [[100]], [false], { min: 0, max: 1 })).toEqual({ min: 0, max: 1 })
  })
})
