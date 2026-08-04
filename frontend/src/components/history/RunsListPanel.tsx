import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Activity, Search, Trash2 } from 'lucide-react'
import type React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { HistoryFilterState, RunRecordExt } from './types'

type RunsListPanelProps = {
  searchInputRef?: React.RefObject<HTMLInputElement | null>

  runs: RunRecordExt[]
  selectedId: string | null
  selectedIds: string[]
  filters: HistoryFilterState
  allTags: string[]
  allTemplateSources: string[]
  onFilterChange: (patch: Partial<HistoryFilterState>) => void
  onSelectRun: (id: string) => void
  onOpenMonitor: (id: string) => void
  onToggleSelect: (id: string, checked: boolean) => void
  onToggleSelectAll: (checked: boolean) => void
  onBatchDelete: () => void
  statusColor: (status: string) => string
  formatTime: (s: string) => string
  formatBytes: (bytes: number) => string
}

export function RunsListPanel({
  searchInputRef,
  runs,
  selectedId,
  selectedIds,
  filters,
  allTags,
  allTemplateSources,
  onFilterChange,
  onSelectRun,
  onOpenMonitor,
  onToggleSelect,
  onToggleSelectAll,
  onBatchDelete,
  statusColor,
  formatTime,
  formatBytes,
}: RunsListPanelProps) {
  return (
    <section className="h-full bg-background p-4 lg:p-5">
      <header className="mb-4 flex items-center justify-between"><div><h2 className="text-xs font-semibold">运行索引</h2><p className="text-[10px] uppercase text-muted-foreground">Run inventory</p></div><span className="font-mono text-xs text-muted-foreground">{runs.length}</span></header>
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          <div className="relative xl:col-span-2"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" ref={searchInputRef} value={filters.search} onChange={(e) => onFilterChange({ search: e.target.value })} placeholder="搜索 ID / 标签 / 模板" /></div>
          <Select value={filters.status} onValueChange={(v) => onFilterChange({ status: v as HistoryFilterState['status'] })}>
            <SelectTrigger><SelectValue placeholder="状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="finished">finished</SelectItem>
              <SelectItem value="running">running</SelectItem>
              <SelectItem value="error">error</SelectItem>
              <SelectItem value="idle">idle</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.timeRange} onValueChange={(v) => onFilterChange({ timeRange: v as HistoryFilterState['timeRange'] })}>
            <SelectTrigger><SelectValue placeholder="时间" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部时间</SelectItem>
              <SelectItem value="24h">近 24 小时</SelectItem>
              <SelectItem value="7d">近 7 天</SelectItem>
              <SelectItem value="30d">近 30 天</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.tag} onValueChange={(v) => onFilterChange({ tag: v })}>
            <SelectTrigger><SelectValue placeholder="标签" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部标签</SelectItem>
              {allTags.map((tag) => <SelectItem key={tag} value={tag}>{tag}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.templateSource} onValueChange={(v) => onFilterChange({ templateSource: v })}>
            <SelectTrigger><SelectValue placeholder="模板来源" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模板来源</SelectItem>
              {allTemplateSources.map((source) => <SelectItem key={source} value={source}>{source}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between border border-border px-3 py-2">
          <label className="text-xs flex items-center gap-2">
            <input type="checkbox" checked={runs.length > 0 && selectedIds.length === runs.length} onChange={(e) => onToggleSelectAll(e.target.checked)} />
            全选（{selectedIds.length}/{runs.length}）
          </label>
          <Button variant="outline" size="sm" onClick={onBatchDelete} disabled={selectedIds.length === 0}><Trash2 />删除所选</Button>
        </div>

        <div className="space-y-2 max-h-[62vh] overflow-auto pr-1">
          {runs.length === 0 ? <p className="text-sm text-muted-foreground py-8 text-center">暂无符合条件的历史记录</p> : runs.map((r) => (
            <div
              key={r.id}
              className={`border-l-2 border-y border-r p-3 cursor-pointer transition-colors hover:bg-muted/50 ${selectedId === r.id ? 'border-l-primary border-y-border border-r-border bg-primary/5' : 'border-border'}`}
              onClick={() => onSelectRun(r.id)}
            >
              <div className="flex items-center justify-between gap-2">
                <label className="shrink-0" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={(e) => onToggleSelect(r.id, e.target.checked)} />
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono truncate">{r.id.slice(0, 8)}</code>
                    <span className={`text-xs font-medium ${statusColor(r.status)}`}>{r.status}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{formatTime(r.start_time)} · {formatBytes(r.disk_bytes)}</div>
                  <div className="text-xs text-muted-foreground mt-1">标签: {r.tags?.join(', ') || '未标记'} · 来源: {r.template_source || 'manual'}</div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  title="打开监控"
                  aria-label={`监控运行 ${r.id}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpenMonitor(r.id)
                  }}
                >
                  <Activity />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
