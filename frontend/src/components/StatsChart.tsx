import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { StatsDataPoint } from '@/types/api'

interface StatsChartProps {
  data: StatsDataPoint[]
  title: string
  type: 'iops' | 'bw' | 'lat'
  height?: number
}

export function StatsChart({ data, title, type, height = 300 }: StatsChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [width, setWidth] = useState(800)

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

    // Prepare uplot data format: [times, ...series]
    // fio status "time" can be elapsed ms or Unix s; uPlot needs strictly increasing x. Use linear scale.
    const rawTimes = data.map((d) => d.time)
    const anyLarge = rawTimes.some((t) => t >= 1e9)
    const toSeconds = (t: number) => (anyLarge ? t : t / 1000)
    let times = rawTimes.map(toSeconds)
    // Ensure strictly increasing (uPlot requirement)
    let last = -Infinity
    times = times.map((t) => {
      if (t <= last) last = last + 0.001
      else last = t
      return last
    })

    let series: uPlot.Series[] = []
    let values: number[][] = []

    if (type === 'iops') {
      series = [
        { label: 'Total IOPS', stroke: '#2563eb', width: 2 },
        { label: 'Read IOPS', stroke: '#10b981', width: 2 },
        { label: 'Write IOPS', stroke: '#f59e0b', width: 2 },
      ]
      values = [
        data.map((d) => d.iops),
        data.map((d) => d.iopsRead),
        data.map((d) => d.iopsWrite),
      ]
    } else if (type === 'bw') {
      series = [
        { label: 'Total BW (MB/s)', stroke: '#2563eb', width: 2 },
        { label: 'Read BW (MB/s)', stroke: '#10b981', width: 2 },
        { label: 'Write BW (MB/s)', stroke: '#f59e0b', width: 2 },
      ]
      values = [
        data.map((d) => d.bw),
        data.map((d) => d.bwRead),
        data.map((d) => d.bwWrite),
      ]
    } else if (type === 'lat') {
      series = [
        { label: 'Mean (ms)', stroke: '#2563eb', width: 2 },
        { label: 'P50 (ms)', stroke: '#10b981', width: 2 },
        { label: 'P95 (ms)', stroke: '#f59e0b', width: 2 },
        { label: 'P99 (ms)', stroke: '#ef4444', width: 2 },
      ]
      values = [
        data.map((d) => d.latMean),
        data.map((d) => d.latP50),
        data.map((d) => d.latP95),
        data.map((d) => d.latP99),
      ]
    }

    const plotData: uPlot.AlignedData = [times, ...values]

    const safeWidth = Math.max(1, width)
    const opts: uPlot.Options = {
      title,
      width: safeWidth,
      height,
      series: [
        {
          // x-axis (time)
          label: 'Time',
        },
        ...series,
      ],
      axes: [
        {
          label: 'Time (s)',
          stroke: '#666',
          grid: { show: true, stroke: '#e5e7eb', width: 1 },
        },
        {
          label: type === 'iops' ? 'IOPS' : type === 'bw' ? 'MB/s' : 'ms',
          stroke: '#666',
          grid: { show: true, stroke: '#e5e7eb', width: 1 },
        },
      ],
      scales: {
        x: { min: 0, time: false },
      },
      legend: {
        show: true,
        live: false,
      },
      cursor: {
        show: true,
        x: true,
        y: true,
      },
    }

    if (plotRef.current) {
      // Update existing plot in-place for real-time updates (no destroy/recreate)
      plotRef.current.setData(plotData, false)
      plotRef.current.setSize({ width: safeWidth, height })
      const minX = Math.min(...times)
      const maxX = Math.max(...times)
      plotRef.current.setScale('x', { min: minX, max: maxX })
    } else {
      // Create new plot
      plotRef.current = new uPlot(opts, plotData, chartRef.current)
    }
  }, [data, type, title, width, height])

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
      <div ref={chartRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}
