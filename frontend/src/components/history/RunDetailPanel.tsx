import { Copy, FilePlus2, Play, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatsChart } from '@/components/StatsChart'
import type { FioTaskList, StatsDataPoint } from '@/types/api'
import type { HistoryAction, RunDetail } from './types'

type RunDetailPanelProps = {
  detail: RunDetail | null
  statsData: StatsDataPoint[]
  statsTab: 'iops' | 'bw' | 'lat'
  onStatsTabChange: (tab: 'iops' | 'bw' | 'lat') => void
  onAction: (action: HistoryAction) => void
  statusColor: (status: string) => string
  formatBytes: (bytes: number) => string
}

function hasConfig(config: FioTaskList | null): boolean {
  return Boolean(config?.tasks?.length)
}

export function RunDetailPanel({ detail, statsData, statsTab, onStatsTabChange, onAction, statusColor, formatBytes }: RunDetailPanelProps) {
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
      <CardContent className="space-y-4 max-h-[72vh] overflow-auto">
        {!detail ? <p className="text-sm text-muted-foreground">请选择左侧运行记录查看详情。</p> : (
          <>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>ID: <code>{detail.meta.id}</code></div>
              <div>状态: <span className={statusColor(detail.meta.status)}>{detail.meta.status}</span></div>
              <div>占用: {formatBytes(detail.meta.disk_bytes)}</div>
              <div>来源: {detail.meta.template_source || 'manual'}</div>
            </div>
            {detail.meta.summary && (
              <div className="rounded border border-border p-3 text-xs grid grid-cols-3 gap-2">
                <span>IOPS: {detail.meta.summary.iops.toFixed(0)}</span>
                <span>BW: {detail.meta.summary.bw.toFixed(1)} MB/s</span>
                <span>Lat: {detail.meta.summary.lat_mean.toFixed(2)} ms</span>
              </div>
            )}
            {statsData.length > 0 && (
              <div className="rounded border border-border p-3 space-y-3">
                <div className="flex gap-2 text-xs">
                  {(['iops', 'bw', 'lat'] as const).map((tab) => (
                    <button key={tab} className={`px-3 py-1.5 rounded-md border ${statsTab === tab ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted text-muted-foreground border-transparent'}`} onClick={() => onStatsTabChange(tab)}>{tab.toUpperCase()}</button>
                  ))}
                </div>
                {statsTab === 'iops' && <StatsChart data={statsData} title="IOPS" type="iops" height={240} />}
                {statsTab === 'bw' && <StatsChart data={statsData} title="带宽" type="bw" height={240} />}
                {statsTab === 'lat' && <StatsChart data={statsData} title="延迟" type="lat" height={240} />}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
