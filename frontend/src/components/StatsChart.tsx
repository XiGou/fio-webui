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

  // Update width on resize
  useEffect(() => {
    if (!chartRef.current) return
    const updateWidth = () => {
      if (chartRef.current) {
        setWidth(chartRef.current.offsetWidth || 800)
      }
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
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
    const times = data.map((d) => d.time)
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

    const opts: uPlot.Options = {
      title,
      width,
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
          label: 'Time',
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
        x: { time: true },
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
      // Update existing plot
      plotRef.current.setData(plotData, false)
      plotRef.current.setSize({ width, height })
    } else {
      // Create new plot
      plotRef.current = new uPlot(opts, plotData, chartRef.current)
    }

    return () => {
      if (plotRef.current) {
        plotRef.current.destroy()
        plotRef.current = null
      }
    }
  }, [data, type, title, width, height])

  return (
    <div className="w-full">
      <div ref={chartRef} style={{ width: '100%', height: `${height}px` }} />
    </div>
  )
}
