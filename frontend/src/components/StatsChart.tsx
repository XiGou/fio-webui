import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { StatsDataPoint } from '@/types/api'
import { describeMetricPresentation } from '@/lib/statsFormat'
import { getNormalizedTimeline, type ChartDomain } from '@/lib/chartRanges'
import { buildLiveMetricSeries, type LatencyStatistic, type MetricDirection, type MetricJobOption } from '@/lib/metricSeries'

interface StatsChartProps {
  data: StatsDataPoint[]
  title: string
  type: 'iops' | 'bw' | 'lat'
  height?: number
  xDomain?: ChartDomain | null
  followLatest?: boolean
  onUserDomainChange?: (domain: ChartDomain) => void
  jobs: MetricJobOption[]
  selectedJobKeys: string[]
  directions: MetricDirection[]
  latencyStatistics: LatencyStatistic[]
}

function formatTimeTick(value: number, current: number, followLatest: boolean): string {
  if (!followLatest) return `${Number(value).toFixed(0)}s`
  const age = current - value
  if (Math.abs(age) < 0.5) return '现在'
  return `-${Math.max(0, age).toFixed(age < 10 ? 1 : 0).replace(/\.0$/, '')}s`
}

export function StatsChart({ data, title, type, height = 300, xDomain, followLatest = false, onUserDomainChange, jobs, selectedJobKeys, directions, latencyStatistics }: StatsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const domainCallbackRef = useRef(onUserDomainChange)
  const [width, setWidth] = useState(800)
  const prevChartRef = useRef<{ type: string; title: string; followLatest: boolean; seriesKey: string } | null>(null)

  useEffect(() => {
    domainCallbackRef.current = onUserDomainChange
  }, [onUserDomainChange])

  // Update width when container resizes (e.g. when Status panel opens)
  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const updateWidth = () => {
      const w = el.offsetWidth
      if (w > 0) setWidth(w)
    }
    updateWidth()
    const ro = new ResizeObserver(updateWidth)
    ro.observe(el)
    window.addEventListener('resize', updateWidth)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  useEffect(() => {
    if (!chartRef.current || data.length === 0) {
      // Destroy plot if no data
      if (plotRef.current) {
        plotRef.current.destroy()
        plotRef.current = null
      }
      return
    }

    const times = getNormalizedTimeline(data)

    const definitions = buildLiveMetricSeries(data, type, jobs, selectedJobKeys, directions, latencyStatistics)
    const seriesKey = definitions.map((definition) => definition.label).join('|')
    const numericValues = definitions.flatMap((definition) => definition.values.filter((value): value is number => value != null))
    const presentation = describeMetricPresentation(type, numericValues)
    const values = definitions.map((definition) => definition.values.map((value) => value == null ? null : presentation.transform(value)))
    const plotData: uPlot.AlignedData = [times, ...values]

    const safeWidth = Math.max(1, width)
    const maxX = times[times.length - 1] ?? 1

    // Latency y-scale: ensure visible range when all zeros
    const yRangeLat: uPlot.Range.Function | undefined =
      type === 'lat'
        ? (_u, _initMin, initMax) => [0, Math.max(1, initMax)] as uPlot.Range.MinMax
        : undefined

    const opts: uPlot.Options = {
      title,
      width: safeWidth,
      height,
      series: [
        { label: 'Time (s)' },
        ...definitions.map((definition) => ({
          label: `${definition.label} (${presentation.unit})`,
          stroke: definition.color,
          width: definition.width,
          dash: definition.dash,
          value: (_u: uPlot, value: number | null) =>
            value == null ? '' : `${Number(value).toFixed(Math.abs(Number(value)) >= 10 ? 0 : 2)} ${presentation.unit}`,
        })),
      ],
      axes: [
        {
          label: followLatest ? '距当前' : 'Elapsed (s)',
          stroke: '#666',
          grid: { show: true, stroke: '#e5e7eb', width: 1 },
          values: (plot, splits) => {
            const current = Number(plot.scales.x.max ?? maxX)
            return splits.map((split) => formatTimeTick(Number(split), current, followLatest))
          },
        },
        {
          label: presentation.axisLabel,
          stroke: '#666',
          grid: { show: true, stroke: '#e5e7eb', width: 1 },
          values: (_u, splits) => splits.map((split) => `${Number(split).toFixed(Math.abs(Number(split)) >= 10 ? 0 : 1)}`),
        },
      ],
      scales: {
        x: { min: xDomain?.min ?? 0, max: xDomain?.max ?? Math.max(1, maxX), time: false },
        ...(type === 'lat' && yRangeLat ? { y: { range: yRangeLat } } : {}),
      },
      legend: {
        show: true,
        live: true,
        isolate: true,
      },
      cursor: {
        show: true,
        x: true,
        y: true,
        drag: {
          x: true,
          y: false,
          setScale: true,
        },
      },
      hooks: {
        setSelect: [
          (plot) => {
            if (plot.select.width <= 0) return
            const start = plot.posToVal(plot.select.left, 'x')
            const end = plot.posToVal(plot.select.left + plot.select.width, 'x')
            domainCallbackRef.current?.({ min: Math.max(0, Math.min(start, end)), max: Math.max(start, end) })
          },
        ],
      },
    }

    if (plotRef.current) {
      if (prevChartRef.current?.type !== type || prevChartRef.current.title !== title || prevChartRef.current.followLatest !== followLatest || prevChartRef.current.seriesKey !== seriesKey) {
        // Metric definitions and the uPlot title are immutable after construction.
        plotRef.current.destroy()
        plotRef.current = null
      } else {
        // type 没变，直接 setData 复用
        plotRef.current.setData(plotData, false)
        plotRef.current.setSize({ width: safeWidth, height })
        const domain = xDomain ?? { min: 0, max: maxX }
        plotRef.current.setScale('x', domain)
      }
    }
    prevChartRef.current = { type, title, followLatest, seriesKey }

    if (!plotRef.current) {
      plotRef.current = new uPlot(opts, plotData, chartRef.current!)
      if (xDomain) {
        plotRef.current.setScale('x', xDomain)
      }
    }
  }, [data, type, title, width, height, xDomain, followLatest, jobs, selectedJobKeys, directions, latencyStatistics])

  // Destroy only on unmount
  useEffect(() => {
    return () => {
      if (plotRef.current) {
        plotRef.current.destroy()
        plotRef.current = null
      }
    }
  }, [])

  return (
    <div className="w-full">
      <div ref={chartRef} className="metric-chart live-chart" style={{ width: '100%', minHeight: `${height + 52}px` }} />
    </div>
  )
}
