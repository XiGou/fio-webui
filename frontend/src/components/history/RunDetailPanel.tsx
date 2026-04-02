import { Copy, FilePlus2, Play, Save, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatsChart } from '@/components/StatsChart'
import type { FioTaskList, StatsDataPoint } from '@/types/api'
import type { HistoryAction, RunDetail } from './types'

type RunDetailPanelProps = {
  detail: RunDetail | null
  statsData: StatsDataPoint[]
  statsTab: 'iops' | 'bw' | 'lat'
  statsRange: 'all' | '15m' | '1h' | '6h' | '24h'
  onStatsTabChange: (tab: 'iops' | 'bw' | 'lat') => void
  onStatsRangeChange: (range: 'all' | '15m' | '1h' | '6h' | '24h') => void
  onAction: (action: HistoryAction) => void
  statusColor: (status: string) => string
  formatBytes: (bytes: number) => string
}

function hasConfig(config: FioTaskList | null): boolean {
  return Boolean(config?.tasks?.length)
}

export function RunDetailPanel({ detail, statsData, statsTab, statsRange, onStatsTabChange, onStatsRangeChange, onAction, statusColor, formatBytes }: RunDetailPanelProps) {
  const [compareMode, setCompareMode] = useState(false)
  const [zoomWindow, setZoomWindow] = useState({ start: 0, end: 100 })
  const [xDomain, setXDomain] = useState<{ min: number; max: number } | null>(null)

  const filteredStats = statsRange === 'all' || statsData.length === 0 ? statsData : (() => {
    const secMap = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400 } as const
    const tail = statsData[statsData.length - 1]?.time ?? 0
    const threshold = tail - secMap[statsRange]
    return statsData.filter((item) => item.time >= threshold)
  })()

  const zoomedStats = useMemo(() => {
    if (filteredStats.length === 0) return filteredStats
    const [startPoint, endPoint] = [
      Math.floor((zoomWindow.start / 100) * (filteredStats.length - 1)),
      Math.ceil((zoomWindow.end / 100) * (filteredStats.length - 1)),
    ]
    return filteredStats.slice(Math.max(0, startPoint), Math.max(startPoint + 1, endPoint + 1))
  }, [filteredStats, zoomWindow])

  const chartTypes: Array<'iops' | 'bw' | 'lat'> = compareMode ? ['iops', 'bw', 'lat'] : [statsTab]

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">RunDetailPanel</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction('restore-workflow')} disabled={!hasConfig(detail?.config ?? null)}><Play className="h-4 w-4 mr-1" />恢复到画布</Button>
            <Button size="sm" variant="outline" onClick={() => onAction('duplicate')} disabled={!hasConfig(detail?.config ?? null)}><Copy className="h-4 w-4 mr-1" />复制配置</Button>
            <Button size="sm" variant="outline" onClick={() => onAction('save-template')} disabled={!hasConfig(detail?.config ?? null)}><Save className="h-4 w-4 mr-1" />另存模板</Button>
            <Button size="sm" variant="outline" onClick={() => onAction('export-report')} disabled={!detail}><FilePlus2 className="h-4 w-4 mr-1" />导出报告</Button>
            <Button size="sm" variant="destructive" onClick={() => onAction('delete')} disabled={!detail}><Trash2 className="h-4 w-4 mr-1" />删除</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 max-h-[72vh] overflow-auto">
        {!detail ? <p className="text-sm text-muted-foreground">请选择左侧运行记录查看详情。</p> : (
          <>
            <details open className="rounded border border-border p-2 text-xs">
              <summary className="cursor-pointer font-medium">基础信息</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>ID: <code>{detail.meta.id}</code></div>
                <div>状态: <span className={statusColor(detail.meta.status)}>{detail.meta.status}</span></div>
                <div>占用: {formatBytes(detail.meta.disk_bytes)}</div>
                <div>来源: {detail.meta.template_source || 'manual'}</div>
              </div>
            </details>
            {detail.meta.summary && (
              <details open className="rounded border border-border p-2 text-xs">
                <summary className="cursor-pointer font-medium">指标摘要</summary>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <span>IOPS: {detail.meta.summary.iops.toFixed(0)}</span>
                  <span>BW: {detail.meta.summary.bw.toFixed(1)} MB/s</span>
                  <span>Lat: {detail.meta.summary.lat_mean.toFixed(2)} ms</span>
                </div>
              </details>
            )}
            {statsData.length > 0 && (
              <div className="rounded border border-border p-3 space-y-3">
                <div className="flex flex-wrap gap-2 text-xs">
                  {(['iops', 'bw', 'lat'] as const).map((tab) => (
                    <button key={tab} className={`px-3 py-1.5 rounded-md border ${statsTab === tab ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`} onClick={() => onStatsTabChange(tab)}>{tab.toUpperCase()}</button>
                  ))}
                  <button className={`px-3 py-1.5 rounded-md border ${compareMode ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`} onClick={() => setCompareMode((v) => !v)}>指标对比</button>
                  <select className="ml-auto rounded-md border bg-background px-2 py-1" value={statsRange} onChange={(e) => onStatsRangeChange(e.target.value as 'all' | '15m' | '1h' | '6h' | '24h')}>
                    <option value="all">全部</option>
                    <option value="15m">15分钟</option>
                    <option value="1h">1小时</option>
                    <option value="6h">6小时</option>
                    <option value="24h">24小时</option>
                  </select>
                </div>
                <div className="rounded-md border border-border p-2">
                  <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>局部放大窗口：{zoomWindow.start}% - {zoomWindow.end}%</span>
                    <button className="rounded border border-border px-2 py-1 hover:bg-muted" onClick={() => { setZoomWindow({ start: 0, end: 100 }); setXDomain(null) }}>重置缩放</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="range" min={0} max={95} value={zoomWindow.start} onChange={(e) => setZoomWindow((prev) => ({ ...prev, start: Math.min(Number(e.target.value), prev.end - 5) }))} className="w-full" />
                    <input type="range" min={5} max={100} value={zoomWindow.end} onChange={(e) => setZoomWindow((prev) => ({ ...prev, end: Math.max(Number(e.target.value), prev.start + 5) }))} className="w-full" />
                  </div>
                </div>
                <div className={compareMode ? 'grid grid-cols-1 gap-3 xl:grid-cols-2' : ''}>
                  {chartTypes.map((chartType) => (
                    <StatsChart
                      key={chartType}
                      data={zoomedStats}
                      title={chartType === 'iops' ? 'IOPS' : chartType === 'bw' ? '带宽' : '延迟'}
                      type={chartType}
                      height={220}
                      xDomain={xDomain}
                      onDomainChange={setXDomain}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
