import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatsChart } from '@/components/StatsChart'
import { History, Copy, Trash2, FileText, X } from 'lucide-react'
import type { RunRecord, FioTaskList, LogSummary, StatsDataPoint } from '@/types/api'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatTime(s: string): string {
  try {
    const d = new Date(s)
    return d.toLocaleString()
  } catch {
    return s
  }
}

export function HistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detail, setDetail] = useState<{ meta: RunRecord; config: FioTaskList | null } | null>(null)
  const [logSummary, setLogSummary] = useState<LogSummary | null>(null)
  const [statsData, setStatsData] = useState<StatsDataPoint[]>([])
  const [statsTab, setStatsTab] = useState<'iops' | 'bw' | 'lat'>('iops')
  const navigate = useNavigate()

  const normalizeStatsPoint = useCallback((raw: unknown): StatsDataPoint | null => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const time = Number(r.time)
    if (!Number.isFinite(time) || time < 0) return null
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
    return {
      time,
      iops: num(r.iops),
      iopsRead: num(r.iopsRead),
      iopsWrite: num(r.iopsWrite),
      bw: num(r.bw),
      bwRead: num(r.bwRead),
      bwWrite: num(r.bwWrite),
      latMean: num(r.latMean),
      latP95: num(r.latP95),
      latP99: num(r.latP99),
      latMax: num(r.latMax),
    }
  }, [])

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/runs')
      if (!res.ok) return
      const data = (await res.json()) as RunRecord[]
      setRuns(data)
    } catch {
      setRuns([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRuns()
  }, [fetchRuns])

  const openDetail = useCallback(async (id: string) => {
    setDetail(null)
    setLogSummary(null)
    setStatsData([])
    try {
      const [detailRes, statsRes] = await Promise.all([
        fetch(`/api/runs/${id}`),
        fetch(`/api/runs/${id}/stats`),
      ])
      if (!detailRes.ok) {
        setDetailOpen(false)
        return
      }
      const data = (await detailRes.json()) as { meta: RunRecord; config: FioTaskList | null }
      setDetail(data)
      setDetailOpen(true)
      if (statsRes.ok) {
        const statsRaw = (await statsRes.json()) as unknown
        if (Array.isArray(statsRaw) && statsRaw.length > 0) {
          const pts = statsRaw.map((x) => normalizeStatsPoint(x)).filter(Boolean) as StatsDataPoint[]
          setStatsData(pts)
        }
      }
    } catch {
      setDetailOpen(false)
    }
  }, [normalizeStatsPoint])

  const closeDetail = useCallback(() => {
    setDetailOpen(false)
    setDetail(null)
    setLogSummary(null)
    setStatsData([])
  }, [])

  const fetchLogSummary = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/runs/${id}/log-summary`)
      if (!res.ok) return
      const data = (await res.json()) as LogSummary
      setLogSummary(data)
    } catch {
      setLogSummary(null)
    }
  }, [])

  const copyAndRerun = useCallback(
    (config: FioTaskList | null) => {
      if (!config || !config.tasks?.length) return
      closeDetail()
      navigate('/legacy', { replace: true, state: { runConfig: config } })
    },
    [navigate, closeDetail]
  )

  const deleteRun = useCallback(
    async (id: string) => {
      if (!confirm('删除此任务及所有数据？')) return
      try {
        await fetch(`/api/runs/${id}`, { method: 'DELETE' })
        if (detail?.meta.id === id) {
          closeDetail()
        }
        fetchRuns()
      } catch {
        // ignore
      }
    },
    [detail?.meta.id, closeDetail, fetchRuns]
  )

  const statusColor = (status: string) => {
    switch (status) {
      case 'finished':
        return 'text-green-600'
      case 'error':
        return 'text-red-600'
      case 'running':
        return 'text-blue-600'
      default:
        return 'text-muted-foreground'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-muted-foreground">加载中...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <History className="h-5 w-5" />
          历史任务
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          查看已运行的 FIO 任务，点击任务查看详情，可复制参数重新执行或删除记录
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">任务列表</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">暂无历史记录</p>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-border p-3 cursor-pointer transition-colors hover:bg-muted/50 hover:border-primary/50"
                  onClick={() => openDetail(r.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-xs font-mono truncate">{r.id.slice(0, 8)}</code>
                        <span className={`text-xs font-medium ${statusColor(r.status)}`}>
                          {r.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {formatTime(r.start_time)} · {formatBytes(r.disk_bytes)}
                      </div>
                      {r.summary && (
                        <div className="text-xs text-muted-foreground mt-1">
                          IOPS {r.summary.iops.toFixed(0)} · BW {r.summary.bw.toFixed(1)} MB/s
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0 h-8 w-8 p-0"
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteRun(r.id)
                      }}
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 任务详情弹窗 */}
      {detailOpen && detail && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={closeDetail}
            aria-hidden="true"
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-5xl max-h-[90vh] flex flex-col shadow-xl">
              <CardHeader className="flex flex-row items-center justify-between pb-2 shrink-0">
                <CardTitle className="text-base">任务详情</CardTitle>
                <Button variant="ghost" size="sm" onClick={closeDetail} className="h-8 w-8 p-0">
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="flex-1 overflow-auto space-y-4">
                <div className="flex flex-wrap gap-2">
                  <div className="text-xs">
                    <span className="text-muted-foreground">ID:</span>{' '}
                    <code className="font-mono">{detail.meta.id}</code>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">状态:</span>{' '}
                    <span className={statusColor(detail.meta.status)}>{detail.meta.status}</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">磁盘占用:</span>{' '}
                    {formatBytes(detail.meta.disk_bytes)}
                  </div>
                </div>
                {detail.meta.error && (
                  <div className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {detail.meta.error}
                  </div>
                )}
                {detail.meta.summary && (
                  <div className="rounded border border-border p-3 text-sm space-y-1">
                    <div className="font-medium text-foreground">性能摘要</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <span>IOPS: {detail.meta.summary.iops.toFixed(0)}</span>
                      <span>BW: {detail.meta.summary.bw.toFixed(1)} MB/s</span>
                      <span>Lat: {detail.meta.summary.lat_mean.toFixed(2)} ms</span>
                    </div>
                  </div>
                )}
                {/* 性能曲线图 */}
                {statsData.length > 0 && (
                  <div className="rounded border border-border p-3 space-y-3">
                    <div className="font-medium text-foreground">性能曲线</div>
                    <div className="flex gap-2 border-b border-border pb-2 text-xs">
                      <button
                        type="button"
                        className={`px-3 py-1.5 rounded-md border ${
                          statsTab === 'iops'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                        }`}
                        onClick={() => setStatsTab('iops')}
                      >
                        IOPS
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 rounded-md border ${
                          statsTab === 'bw'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                        }`}
                        onClick={() => setStatsTab('bw')}
                      >
                        带宽
                      </button>
                      <button
                        type="button"
                        className={`px-3 py-1.5 rounded-md border ${
                          statsTab === 'lat'
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
                        }`}
                        onClick={() => setStatsTab('lat')}
                      >
                        延迟
                      </button>
                    </div>
                    <div className="min-h-[280px]">
                      {statsTab === 'iops' && (
                        <StatsChart data={statsData} title="IOPS" type="iops" height={280} />
                      )}
                      {statsTab === 'bw' && (
                        <StatsChart data={statsData} title="带宽 (MB/s)" type="bw" height={280} />
                      )}
                      {statsTab === 'lat' && (
                        <StatsChart data={statsData} title="延迟 (ms)" type="lat" height={280} />
                      )}
                    </div>
                  </div>
                )}
                {detail.config && (
                  <div className="rounded border border-border p-3 text-sm">
                    <div className="font-medium text-foreground mb-2">执行参数</div>
                    <div className="space-y-2 text-xs text-muted-foreground">
                      {detail.config.tasks?.map((t, i) => (
                        <div key={i}>
                          <span className="font-medium text-foreground">{t.name}</span>
                          <ul className="mt-1 ml-2 list-disc">
                            {t.jobs?.map((j, jj) => (
                              <li key={jj}>
                                {j.name}: {j.rw} {j.bs} {j.filename}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => copyAndRerun(detail.config)}
                    disabled={!detail.config?.tasks?.length}
                  >
                    <Copy className="h-4 w-4 mr-1" />
                    复制参数并重跑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fetchLogSummary(detail.meta.id)}
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    查看日志摘要
                  </Button>
                </div>
                {logSummary !== null && (
                  <div className="rounded border border-border p-3 text-sm space-y-2">
                    <div className="font-medium text-foreground">日志摘要与错误</div>
                    {logSummary.summary && (
                      <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                        {logSummary.summary}
                      </pre>
                    )}
                    {logSummary.errors?.length ? (
                      <div>
                        <div className="text-xs font-medium text-destructive mb-1">错误信息</div>
                        <pre className="text-xs bg-destructive/10 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap text-destructive">
                          {logSummary.errors.join('\n')}
                        </pre>
                      </div>
                    ) : (
                      !logSummary.summary && (
                        <p className="text-xs text-muted-foreground">无摘要或错误</p>
                      )
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
