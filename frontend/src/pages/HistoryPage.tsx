import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History } from 'lucide-react'
import { addUserPreset, buildConfigSummaryFromJobs } from '@/lib/userPresets'
import { RunsListPanel } from '@/components/history/RunsListPanel'
import { RunDetailPanel } from '@/components/history/RunDetailPanel'
import { ArtifactsPanel } from '@/components/history/ArtifactsPanel'
import type { LogSummary, StatsDataPoint } from '@/types/api'
import type { HistoryAction, HistoryFilterState, RunDetail, RunRecordExt } from '@/components/history/types'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
}

function formatTime(s: string): string {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  URL.revokeObjectURL(href)
}

function downloadBlob(filename: string, blob: Blob) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  URL.revokeObjectURL(href)
}

function getFileNameFromDisposition(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback
  const match = disposition.match(/filename="?([^";]+)"?/i)
  return match?.[1] ?? fallback
}

export function HistoryPage() {
  const [runs, setRuns] = useState<RunRecordExt[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [logSummary, setLogSummary] = useState<LogSummary | null>(null)
  const [statsData, setStatsData] = useState<StatsDataPoint[]>([])
  const [statsTab, setStatsTab] = useState<'iops' | 'bw' | 'lat'>('iops')
  const [statsRange, setStatsRange] = useState<'all' | '15m' | '1h' | '6h' | '24h'>('all')
  const [filters, setFilters] = useState<HistoryFilterState>({ search: '', status: 'all', timeRange: 'all', tag: 'all', templateSource: 'all' })
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const navigate = useNavigate()

  const normalizeStatsPoint = useCallback((raw: unknown): StatsDataPoint | null => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const time = Number(r.time)
    if (!Number.isFinite(time) || time < 0) return null
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    return { time, iops: num(r.iops), iopsRead: num(r.iopsRead), iopsWrite: num(r.iopsWrite), bw: num(r.bw), bwRead: num(r.bwRead), bwWrite: num(r.bwWrite), latMean: num(r.latMean), latP95: num(r.latP95), latP99: num(r.latP99), latMax: num(r.latMax) }
  }, [])

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/runs')
      if (!res.ok) return
      const data = (await res.json()) as RunRecordExt[]
      setRuns(data)
    } catch {
      setRuns([])
    } finally {
      setLoading(false)
    }
  }, [])

  const openDetail = useCallback(async (id: string) => {
    setSelectedRunId(id)
    setLogSummary(null)
    setStatsData([])
    try {
      const [detailRes, statsRes] = await Promise.all([fetch(`/api/runs/${id}`), fetch(`/api/runs/${id}/stats`)])
      if (!detailRes.ok) return
      const data = (await detailRes.json()) as RunDetail
      setDetail(data)
      if (statsRes.ok) {
        const statsRaw = (await statsRes.json()) as unknown
        if (Array.isArray(statsRaw)) {
          setStatsData(statsRaw.map((x) => normalizeStatsPoint(x)).filter(Boolean) as StatsDataPoint[])
        }
      }
    } catch {
      // ignore
    }
  }, [normalizeStatsPoint])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  const filteredRuns = useMemo(() => {
    const now = Date.now()
    const limitMap: Record<HistoryFilterState['timeRange'], number> = { all: 0, '24h': 24 * 3600_000, '7d': 7 * 24 * 3600_000, '30d': 30 * 24 * 3600_000 }
    const keyword = filters.search.trim().toLowerCase()
    return runs.filter((run) => {
      if (filters.status !== 'all' && run.status !== filters.status) return false
      if (filters.timeRange !== 'all') {
        const start = new Date(run.start_time).getTime()
        if (!Number.isFinite(start) || now - start > limitMap[filters.timeRange]) return false
      }
      if (filters.tag !== 'all' && !(run.tags ?? []).includes(filters.tag)) return false
      if (filters.templateSource !== 'all' && (run.template_source ?? 'manual') !== filters.templateSource) return false
      if (!keyword) return true
      return `${run.id} ${(run.tags ?? []).join(' ')} ${run.template_source ?? ''} ${run.template_name ?? ''}`.toLowerCase().includes(keyword)
    })
  }, [filters, runs])

  const allTags = useMemo(() => Array.from(new Set(runs.flatMap((r) => r.tags ?? []))).sort(), [runs])
  const allTemplateSources = useMemo(() => Array.from(new Set(runs.map((r) => r.template_source ?? 'manual'))).sort(), [runs])

  const fetchLogSummary = useCallback(async () => {
    if (!detail) return
    const res = await fetch(`/api/runs/${detail.meta.id}/log-summary`)
    if (!res.ok) return
    setLogSummary((await res.json()) as LogSummary)
  }, [detail])

  const restoreToWorkflow = useCallback(() => {
    if (!detail?.config?.tasks?.length) return
    navigate('/', { replace: true, state: { restoreRunConfig: detail.config, restoreRunId: detail.meta.id } })
  }, [detail, navigate])

  const duplicateToLegacy = useCallback(() => {
    if (!detail?.config?.tasks?.length) return
    navigate('/legacy', { replace: true, state: { runConfig: detail.config } })
  }, [detail, navigate])

  const saveAsTemplate = useCallback(() => {
    if (!detail?.config?.tasks?.length) return
    const firstTask = detail.config.tasks[0]
    addUserPreset({
      id: `run-${detail.meta.id}`,
      name: `历史任务-${detail.meta.id.slice(0, 8)}`,
      description: `由运行 ${detail.meta.id} 保存`,
      category: 'user',
      configSummary: buildConfigSummaryFromJobs(firstTask.jobs),
      task: firstTask,
    })
  }, [detail])

  const exportReport = useCallback(async () => {
    if (!detail) return
    const query = new URLSearchParams({ metric: statsTab, timeRange: statsRange }).toString()
    const res = await fetch(`/api/runs/${detail.meta.id}/report.html?${query}`)
    if (!res.ok) {
      downloadJson(`run-${detail.meta.id}-report.json`, { meta: detail.meta, stats: statsData, logSummary, config: detail.config })
      return
    }
    const blob = await res.blob()
    const filename = getFileNameFromDisposition(res.headers.get('Content-Disposition'), `run-${detail.meta.id}-report.html`)
    downloadBlob(filename, blob)
  }, [detail, logSummary, statsData, statsRange, statsTab])

  const deleteRuns = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    if (!window.confirm(`确认删除 ${ids.length} 条运行记录及其数据？`)) return
    await Promise.all(ids.map((id) => fetch(`/api/runs/${id}`, { method: 'DELETE' })))
    if (selectedRunId && ids.includes(selectedRunId)) {
      setDetail(null)
      setSelectedRunId(null)
    }
    setSelectedRunIds((prev) => prev.filter((id) => !ids.includes(id)))
    fetchRuns()
  }, [fetchRuns, selectedRunId])

  const onAction = useCallback((action: HistoryAction) => {
    if (action === 'restore-workflow') restoreToWorkflow()
    if (action === 'duplicate' || action === 'rerun') duplicateToLegacy()
    if (action === 'save-template') saveAsTemplate()
    if (action === 'export-report') exportReport()
    if (action === 'delete' && detail) deleteRuns([detail.meta.id])
  }, [deleteRuns, detail, duplicateToLegacy, exportReport, restoreToWorkflow, saveAsTemplate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
      if ((event.ctrlKey || event.metaKey) && key === 'enter') {
        event.preventDefault()
        onAction('rerun')
      }
      if ((event.ctrlKey || event.metaKey) && key === 'e') {
        event.preventDefault()
        onAction('export-report')
      }
      if (key === 'delete') {
        event.preventDefault()
        if (selectedRunIds.length > 0) deleteRuns(selectedRunIds)
        else onAction('delete')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deleteRuns, onAction, selectedRunIds])

  const statusColor = (status: string) => {
    if (status === 'finished') return 'status-success'
    if (status === 'error') return 'status-failure'
    if (status === 'running') return 'status-running'
    if (status === 'idle') return 'status-warning'
    return 'text-muted-foreground'
  }

  if (loading) return <div className="flex items-center justify-center py-12"><p className="text-muted-foreground">加载中...</p></div>

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2"><History className="h-5 w-5" />历史任务</h2>
        <p className="text-sm text-muted-foreground">快捷键：Ctrl/Cmd+K 搜索，Ctrl/Cmd+Enter 复制运行，Ctrl/Cmd+E 导出，Delete 删除。</p>
      </div>
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-12">
        <div className="2xl:col-span-5">
          <RunsListPanel
            searchInputRef={searchInputRef}
            runs={filteredRuns}
            selectedId={selectedRunId}
            selectedIds={selectedRunIds}
            filters={filters}
            allTags={allTags}
            allTemplateSources={allTemplateSources}
            onFilterChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            onSelectRun={openDetail}
            onToggleSelect={(id, checked) => setSelectedRunIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id))}
            onToggleSelectAll={(checked) => setSelectedRunIds(checked ? filteredRuns.map((r) => r.id) : [])}
            onBatchDelete={() => deleteRuns(selectedRunIds)}
            statusColor={statusColor}
            formatTime={formatTime}
            formatBytes={formatBytes}
          />
        </div>
        <div className="2xl:col-span-4">
          <RunDetailPanel detail={detail} statsData={statsData} statsTab={statsTab} statsRange={statsRange} onStatsTabChange={setStatsTab} onStatsRangeChange={setStatsRange} onAction={onAction} statusColor={statusColor} formatBytes={formatBytes} />
        </div>
        <div className="2xl:col-span-3">
          <ArtifactsPanel detail={detail} logSummary={logSummary} onFetchLogSummary={fetchLogSummary} onExportReport={exportReport} />
        </div>
      </div>
    </div>
  )
}
