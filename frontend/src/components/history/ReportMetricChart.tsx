import { useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { getVisibleYDomain } from '@/lib/chartRanges'
import { buildReportMetricSeries, type LatencyStatistic, type MetricDirection, type MetricJobOption } from '@/lib/metricSeries'
import { describeMetricPresentation } from '@/lib/statsFormat'
import type { ReportJobSeries, ReportSeriesPoint, ReportStageBoundary } from '@/types/api'

type ReportMetric = 'iops' | 'bw' | 'lat'

type ReportMetricChartProps = {
  data: ReportSeriesPoint[]
  stages: ReportStageBoundary[]
  type: ReportMetric
  height?: number
  xDomain: { min: number; max: number } | null
  onDomainChange: (domain: { min: number; max: number }) => void
  jobSeries: ReportJobSeries[]
  jobs: MetricJobOption[]
  selectedJobKeys: string[]
  directions: MetricDirection[]
  latencyStatistics: LatencyStatistic[]
}

const palette = {
  primary: '#157a5b',
  live: '#0b8198',
  warning: '#c56b05',
  destructive: '#b83232',
  graphite: '#29323d',
  grid: '#d7dde2',
  muted: '#65707c',
}

function stageMarkerPlugin(stages: ReportStageBoundary[]): uPlot.Plugin {
  return {
    hooks: {
      draw: [
        (plot) => {
          const { ctx, bbox } = plot
          ctx.save()
          ctx.beginPath()
          ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height)
          ctx.clip()
          ctx.setLineDash([4, 4])
          ctx.lineWidth = 1
          ctx.strokeStyle = 'rgba(41, 50, 61, 0.42)'
          ctx.fillStyle = palette.graphite
          ctx.font = '600 9px ui-monospace, SFMono-Regular, Menlo, monospace'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'alphabetic'
          stages.forEach((stage) => {
            const x = Math.round(plot.valToPos(stage.start_seconds, 'x', true)) + 0.5
            if (x < bbox.left || x > bbox.left + bbox.width) return
            ctx.beginPath()
            ctx.moveTo(x, bbox.top)
            ctx.lineTo(x, bbox.top + bbox.height)
            ctx.stroke()
            ctx.setLineDash([])
            const labelX = Math.max(x + 5, bbox.left + 8)
            ctx.fillText(`OP ${String(stage.index + 1).padStart(2, '0')}`, labelX, bbox.top + 12)
            ctx.setLineDash([4, 4])
          })
          ctx.restore()
        },
      ],
    },
  }
}

function visibleSeriesScalePlugin(data: uPlot.AlignedData): uPlot.Plugin {
  let queued = false
  return {
    hooks: {
      setSeries: [
        (plot, _seriesIndex, options) => {
          if (options.show == null || queued) return
          queued = true
          queueMicrotask(() => {
            queued = false
            const xDomain = {
              min: Number(plot.scales.x.min ?? 0),
              max: Number(plot.scales.x.max ?? 1),
            }
            const domain = getVisibleYDomain(
              data[0] as ArrayLike<number>,
              data.slice(1) as ArrayLike<number | null | undefined>[],
              plot.series.slice(1).map((series) => series.show !== false),
              xDomain,
            )
            plot.setScale('y', domain)
          })
        },
      ],
    },
  }
}

function formatElapsedTick(value: number, span: number): string {
  const decimals = span <= 1 ? 2 : span <= 10 ? 1 : 0
  return `${value.toFixed(decimals).replace(/\.0+$/, '')}s`
}

export function ReportMetricChart({ data, stages, type, height = 260, xDomain, onDomainChange, jobSeries, jobs, selectedJobKeys, directions, latencyStatistics }: ReportMetricChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const domainCallbackRef = useRef(onDomainChange)
  const [width, setWidth] = useState(640)

  useEffect(() => {
    domainCallbackRef.current = onDomainChange
  }, [onDomainChange])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const resize = () => setWidth(Math.max(1, element.clientWidth))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const prepared = useMemo(() => {
    const { times, definitions } = buildReportMetricSeries(data, jobSeries, type, jobs, selectedJobKeys, directions, latencyStatistics)
    const numericValues = definitions.flatMap((definition) => definition.values.filter((value): value is number => value != null))
    const presentation = describeMetricPresentation(type, numericValues)
    return {
      times,
      definitions,
      presentation,
      plotData: [times, ...definitions.map((definition) => definition.values.map((value) => value == null ? null : presentation.transform(value)))] as uPlot.AlignedData,
    }
  }, [data, directions, jobSeries, jobs, latencyStatistics, selectedJobKeys, type])

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return
    plotRef.current?.destroy()

    const maxX = prepared.times.at(-1) ?? 1
    const options: uPlot.Options = {
      width,
      height,
      padding: [8, 10, 0, 0],
      series: [
        { label: 'Elapsed' },
        ...prepared.definitions.map((definition) => ({
          label: `${definition.label} (${prepared.presentation.unit})`,
          stroke: definition.color,
          width: definition.width,
          dash: definition.dash,
          value: (_plot: uPlot, value: number | null) => value == null ? '-' : `${value.toFixed(Math.abs(value) >= 10 ? 1 : 3)} ${prepared.presentation.unit}`,
        })),
      ],
      axes: [
        {
          stroke: palette.muted,
          grid: { show: true, stroke: palette.grid, width: 1 },
          values: (plot, splits) => {
            const span = Number(plot.scales.x.max ?? maxX) - Number(plot.scales.x.min ?? 0)
            return splits.map((value) => formatElapsedTick(Number(value), span))
          },
          size: 42,
        },
        {
          label: prepared.presentation.axisLabel,
          labelSize: 18,
          stroke: palette.muted,
          grid: { show: true, stroke: palette.grid, width: 1 },
          values: (_plot, splits) => splits.map((value) => Number(value).toFixed(Math.abs(Number(value)) >= 10 ? 0 : 2)),
          size: 58,
        },
      ],
      scales: {
        x: { min: 0, max: Math.max(1, maxX), time: false },
        y: { range: (_plot, _min, max) => [0, Math.max(1, max * 1.08)] },
      },
      cursor: {
        drag: { x: true, y: false, setScale: true },
        focus: { prox: 24 },
      },
      legend: { show: true, live: true, isolate: true },
      plugins: [stageMarkerPlugin(stages), visibleSeriesScalePlugin(prepared.plotData)],
      hooks: {
        setScale: [
          (plot, key) => {
            if (key !== 'x') return
            const min = Number(plot.scales.x.min ?? 0)
            const max = Number(plot.scales.x.max ?? maxX)
            domainCallbackRef.current({ min, max })
          },
        ],
      },
    }

    plotRef.current = new uPlot(options, prepared.plotData, containerRef.current)
    return () => {
      plotRef.current?.destroy()
      plotRef.current = null
    }
  }, [data, height, prepared, stages, width])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot || data.length === 0) return
    const maxX = prepared.times.at(-1) ?? 1
    const next = xDomain ?? { min: 0, max: Math.max(1, maxX) }
    const currentMin = Number(plot.scales.x.min ?? 0)
    const currentMax = Number(plot.scales.x.max ?? maxX)
    if (Math.abs(currentMin - next.min) > 0.001 || Math.abs(currentMax - next.max) > 0.001) {
      plot.setScale('x', next)
    }
  }, [data.length, prepared.times, xDomain])

  if (data.length === 0) {
    return <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">没有可绘制的 fio task 日志。</div>
  }

  return <div ref={containerRef} className="metric-chart report-chart min-w-0 overflow-hidden" style={{ height }} />
}
