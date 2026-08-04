import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileChartColumn, History } from 'lucide-react'
import { addUserPreset, buildConfigSummaryFromJobs } from '@/lib/userPresets'
import { RunsListPanel } from '@/components/history/RunsListPanel'
import { RunDetailPanel } from '@/components/history/RunDetailPanel'
import type { RunReportDTO } from '@/types/api'
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
  const [report, setReport] = useState<RunReportDTO | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [filters, setFilters] = useState<HistoryFilterState>({ search: '', status: 'all', timeRange: 'all', tag: 'all', templateSource: 'all' })
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const autoOpenedRunRef = useRef('')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

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
    setReport(null)
    setReportLoading(true)
    setDetailError('')
    try {
      const [detailRes, reportRes] = await Promise.all([fetch(`/api/runs/${id}`), fetch(`/api/runs/${id}/report-data`)])
      if (!detailRes.ok) {
        setDetail(null)
        setDetailError(`加载运行详情失败：${detailRes.status} ${detailRes.statusText || 'Request failed'}`)
        return
      }
      const data = (await detailRes.json()) as RunDetail
      setDetail(data)
      if (reportRes.ok) {
        setReport((await reportRes.json()) as RunReportDTO)
      } else {
        setDetailError(`生成报告失败：${reportRes.status} ${reportRes.statusText || 'Request failed'}`)
      }
    } catch {
      setDetail(null)
      setDetailError('加载运行详情失败：网络错误')
    } finally {
      setReportLoading(false)
    }
  }, [])

  useEffect(() => {
    const requestedRunId = searchParams.get('runId') ?? ''
    if (!requestedRunId || autoOpenedRunRef.current === requestedRunId) return
    autoOpenedRunRef.current = requestedRunId
    openDetail(requestedRunId)
  }, [openDetail, searchParams])

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

  const restoreToWorkflow = useCallback(() => {
    if (!detail?.config?.tasks?.length) return
    navigate('/', { replace: true, state: { restoreRunConfig: detail.config, restoreRunId: detail.meta.id } })
  }, [detail, navigate])

  const duplicateToPipeline = useCallback(() => {
    if (!detail?.config?.tasks?.length) return
    navigate('/', { state: { restoreRunConfig: detail.config, restoreRunId: detail.meta.id } })
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
    const res = await fetch(`/api/runs/${detail.meta.id}/report.html`)
    if (!res.ok) {
      downloadJson(`run-${detail.meta.id}-report.json`, report ?? { meta: detail.meta, config: detail.config })
      return
    }
    const blob = await res.blob()
    const filename = getFileNameFromDisposition(res.headers.get('Content-Disposition'), `run-${detail.meta.id}-report.html`)
    downloadBlob(filename, blob)
  }, [detail, report])

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
    if (action === 'open-monitor' && detail) navigate(`/monitor?runId=${detail.meta.id}`)
    if (action === 'restore-workflow') restoreToWorkflow()
    if (action === 'duplicate' || action === 'rerun') duplicateToPipeline()
    if (action === 'save-template') saveAsTemplate()
    if (action === 'export-report') exportReport()
    if (action === 'delete' && detail) deleteRuns([detail.meta.id])
  }, [deleteRuns, detail, duplicateToPipeline, exportReport, navigate, restoreToWorkflow, saveAsTemplate])

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
    <div className="min-h-full bg-workbench">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-3 lg:px-6">
        <div className="flex h-8 w-8 items-center justify-center bg-foreground text-background"><History className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1"><h1 className="text-base font-semibold">运行与报告</h1><p className="text-[11px] text-muted-foreground">每次运行的配置、性能采样、日志和报告保存在同一记录下。</p></div>
        <div className="flex items-center gap-2 border-l border-border pl-4 text-xs"><FileChartColumn className="h-4 w-4 text-primary" /><span><strong className="font-mono text-base">{runs.length}</strong><small className="ml-1 text-muted-foreground">runs</small></span></div>
      </header>
      <div className="grid grid-cols-1 xl:grid-cols-12">
        <div className={`${selectedRunId ? 'order-2' : 'order-1'} xl:order-1 xl:col-span-4`}>
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
            onOpenMonitor={(id) => navigate(`/monitor?runId=${id}`)}
            onToggleSelect={(id, checked) => setSelectedRunIds((prev) => checked ? Array.from(new Set([...prev, id])) : prev.filter((x) => x !== id))}
            onToggleSelectAll={(checked) => setSelectedRunIds(checked ? filteredRuns.map((r) => r.id) : [])}
            onBatchDelete={() => deleteRuns(selectedRunIds)}
            statusColor={statusColor}
            formatTime={formatTime}
            formatBytes={formatBytes}
          />
        </div>
        <div className={`${selectedRunId ? 'order-1' : 'order-2'} border-t border-border xl:order-2 xl:col-span-8 xl:border-l xl:border-t-0`}>
          <RunDetailPanel key={selectedRunId ?? 'empty'} detail={detail} report={report} loading={reportLoading} detailError={detailError} onAction={onAction} statusColor={statusColor} formatBytes={formatBytes} />
        </div>
      </div>
    </div>
  )
}
