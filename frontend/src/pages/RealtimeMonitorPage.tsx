import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatsChart } from '@/components/StatsChart'
import { filterStatsByTimeRange } from '@/lib/statsFormat'
import type { FioTaskList, LogSummary, RunRecord, RunState, StatsDataPoint, WsMessage } from '@/types/api'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  finished: 'Finished',
  error: 'Error',
}

type RunDetail = {
  meta: RunRecord
  config: FioTaskList | null
}

type WsStatus = 'connecting' | 'open' | 'closed'

function buildWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.hostname
  const port = window.location.port
  const wsPort = port === '5173' || port === '5174' ? '8080' : port
  const wsHost = port === '5173' || port === '5174' ? `${host}:${wsPort}` : window.location.host
  return `${protocol}//${wsHost}/api/events`
}

function formatTime(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function normalizeStatsPoint(raw: unknown): StatsDataPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const time = Number(record.time)
  if (!Number.isFinite(time) || time < 0) return null
  const num = (value: unknown) => {
    const next = Number(value)
    return Number.isFinite(next) ? next : 0
  }
  return {
    time,
    iops: num(record.iops),
    iopsRead: num(record.iopsRead),
    iopsWrite: num(record.iopsWrite),
    bw: num(record.bw),
    bwRead: num(record.bwRead),
    bwWrite: num(record.bwWrite),
    latMean: num(record.latMean),
    latP95: num(record.latP95),
    latP99: num(record.latP99),
    latMax: num(record.latMax),
  }
}

export function RealtimeMonitorPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialRunId = searchParams.get('runId') || ''

  const [runs, setRuns] = useState<RunRecord[]>([])
  const [selectedRunId, setSelectedRunId] = useState(initialRunId)
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null)
  const [runState, setRunState] = useState<RunState | null>(null)
  const [statsData, setStatsData] = useState<StatsDataPoint[]>([])
  const [logSummary, setLogSummary] = useState<LogSummary | null>(null)
  const [loadError, setLoadError] = useState('')
  const [wsStatus, setWsStatus] = useState<WsStatus>('closed')
  const [statsTab, setStatsTab] = useState<'iops' | 'bw' | 'lat'>('iops')
  const [timeRange, setTimeRange] = useState<'15m' | '1h' | '6h' | '24h' | 'all'>('all')
  const [xDomain, setXDomain] = useState<{ min: number; max: number } | null>(null)

  const selectedRunIdRef = useRef(selectedRunId)
  const mountedRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId
  }, [selectedRunId])

  const syncSelectedRunId = useCallback((runId: string) => {
    setSelectedRunId(runId)
    selectedRunIdRef.current = runId
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('runId', runId)
      return next
    }, { replace: true })
  }, [setSearchParams])

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/runs')
      if (!res.ok) return
      const data = (await res.json()) as RunRecord[]
      setRuns(data)
      if (!selectedRunIdRef.current && data.length > 0) {
        const running = data.find((item) => item.status === 'running')
        syncSelectedRunId((running ?? data[0]).id)
      }
    } catch {
      setRuns([])
    }
  }, [syncSelectedRunId])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      if (!res.ok) return
      const data = (await res.json()) as RunState
      setRunState(data.status === 'idle' ? null : data)
    } catch {
      setRunState(null)
    }
  }, [])

  const fetchRunSnapshot = useCallback(async (runId: string) => {
    if (!runId) return
    setLoadError('')
    try {
      const [detailRes, statsRes, logRes] = await Promise.all([
        fetch(`/api/runs/${runId}`),
        fetch(`/api/runs/${runId}/stats`),
        fetch(`/api/runs/${runId}/log-summary`),
      ])

      if (!detailRes.ok) {
        setRunDetail(null)
        setStatsData([])
        setLogSummary(null)
        setLoadError(`加载运行详情失败：${detailRes.status} ${detailRes.statusText || 'Request failed'}`)
        return
      }

      const detail = (await detailRes.json()) as RunDetail
      setRunDetail(detail)

      if (statsRes.ok) {
        const statsRaw = (await statsRes.json()) as unknown
        if (Array.isArray(statsRaw)) {
          setStatsData(statsRaw.map(normalizeStatsPoint).filter(Boolean) as StatsDataPoint[])
        } else {
          setStatsData([])
        }
      } else {
        setStatsData([])
      }

      if (logRes.ok) {
        setLogSummary((await logRes.json()) as LogSummary)
      } else {
        setLogSummary(null)
      }
    } catch {
      setRunDetail(null)
      setStatsData([])
      setLogSummary(null)
      setLoadError('加载运行详情失败：网络错误')
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchRuns()
    fetchStatus()
    const timer = window.setInterval(() => {
      fetchRuns()
      fetchStatus()
    }, 3000)
    return () => {
      mountedRef.current = false
      window.clearInterval(timer)
    }
  }, [fetchRuns, fetchStatus])

  const selectedRun = useMemo(() => runs.find((item) => item.id === selectedRunId) ?? null, [runs, selectedRunId])
  const isSelectedRunning = selectedRun?.status === 'running' || runState?.id === selectedRunId && runState.status === 'running'
  const visibleStatsData = useMemo(() => filterStatsByTimeRange(statsData, timeRange), [statsData, timeRange])
  const runningRuns = useMemo(() => runs.filter((item) => item.status === 'running'), [runs])

  useEffect(() => {
    if (!selectedRunId) return
    fetchRunSnapshot(selectedRunId)
    setXDomain(null)
  }, [fetchRunSnapshot, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || isSelectedRunning) return
    const timer = window.setInterval(() => {
      fetchRunSnapshot(selectedRunId)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [fetchRunSnapshot, isSelectedRunning, selectedRunId])

  useEffect(() => {
    if (!isSelectedRunning || !selectedRunId) {
      const ws = wsRef.current
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING)) {
        ws.close()
      }
      wsRef.current = null
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      setWsStatus('closed')
      return
    }

    let backoff = 1000
    const maxBackoff = 10000
    const wsUrl = buildWsUrl()
    let stale = false

    const connect = () => {
      if (stale || !mountedRef.current || selectedRunIdRef.current !== selectedRunId) return
      setWsStatus('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (stale || selectedRunIdRef.current !== selectedRunId) {
          ws.close()
          return
        }
        backoff = 1000
        setWsStatus('open')
      }

      ws.onmessage = (event) => {
        if (stale) return
        try {
          const msg = JSON.parse(event.data) as WsMessage
          if (msg.type === 'status') {
            const nextState = msg.data as RunState
            setRunState(nextState)
            if (nextState.id === selectedRunIdRef.current) {
              setRunDetail((prev) => prev ? {
                ...prev,
                meta: {
                  ...prev.meta,
                  status: nextState.status,
                  end_time: nextState.end_time || prev.meta.end_time,
                  error: nextState.error || prev.meta.error,
                },
              } : prev)
              if (nextState.status !== 'running') {
                fetchRuns()
                fetchRunSnapshot(nextState.id)
              }
            }
          }

          if (msg.type === 'stats' && selectedRunIdRef.current === selectedRunId) {
            const point = normalizeStatsPoint(msg.data)
            if (!point) return
            setStatsData((prev) => {
              const last = prev[prev.length - 1]
              if (last && last.time === point.time) {
                const next = [...prev]
                next[next.length - 1] = point
                return next
              }
              return [...prev, point]
            })
          }
        } catch {
          // ignore parse noise from malformed messages
        }
      }

      ws.onclose = () => {
        if (stale) return
        wsRef.current = null
        setWsStatus('closed')
        if (!mountedRef.current || selectedRunIdRef.current !== selectedRunId || reconnectTimerRef.current != null) return
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          connect()
        }, Math.min(backoff, maxBackoff))
        backoff = Math.min(backoff * 2, maxBackoff)
      }
    }

    connect()

    return () => {
      stale = true
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      wsRef.current = null
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING)) {
        ws.close()
      }
      setWsStatus('closed')
    }
  }, [fetchRunSnapshot, fetchRuns, isSelectedRunning, selectedRunId])

  const onSelectRun = (runId: string) => {
    syncSelectedRunId(runId)
  }

  const stop = async () => {
    await fetch('/api/stop', { method: 'POST' }).catch(() => {})
    await fetchRuns()
    await fetchStatus()
    if (selectedRunIdRef.current) {
      await fetchRunSnapshot(selectedRunIdRef.current)
    }
  }

  const activeStatus = runDetail?.meta.status || selectedRun?.status || runState?.status || 'idle'
  const activeError = runDetail?.meta.error || (runState?.id === selectedRunId ? runState.error : '') || '-'

  return (
    <div className="min-h-screen space-y-4 bg-background p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">实时监控</h1>
          <p className="text-sm text-muted-foreground">
            运行中的任务走 WebSocket 实时流，已完成任务走 API 快照。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/')}>返回工作流</Button>
          <Button variant="outline" onClick={() => navigate('/history')}>任务管理</Button>
          <Button variant="secondary" onClick={stop} disabled={!isSelectedRunning}>停止当前执行</Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">任务切换</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>运行中：{runningRuns.length}</span>
            <span>当前模式：{isSelectedRunning ? 'WebSocket' : 'API'}</span>
            <span>连接状态：{isSelectedRunning ? wsStatus : 'n/a'}</span>
          </div>
          <div className="flex gap-2 overflow-auto pb-1">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                className={`min-w-[220px] rounded border px-3 py-2 text-left text-xs ${run.id === selectedRunId ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
                onClick={() => onSelectRun(run.id)}
              >
                <p className="font-mono">{run.id.slice(0, 12)}</p>
                <p className={run.status === 'running' ? 'text-blue-600' : run.status === 'error' ? 'text-red-600' : 'text-muted-foreground'}>
                  {STATUS_LABEL[run.status] ?? run.status}
                </p>
                <p className="text-muted-foreground">{formatTime(run.start_time)}</p>
              </button>
            ))}
            {runs.length === 0 ? <p className="text-sm text-muted-foreground">暂无任务</p> : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <CardTitle className="text-base">性能统计</CardTitle>
              <div className="flex flex-wrap gap-2">
                {(['15m', '1h', '6h', '24h', 'all'] as const).map((range) => (
                  <Button key={range} size="sm" variant={timeRange === range ? 'default' : 'outline'} onClick={() => { setTimeRange(range); setXDomain(null) }}>
                    {range.toUpperCase()}
                  </Button>
                ))}
                {(['iops', 'bw', 'lat'] as const).map((key) => (
                  <Button key={key} size="sm" variant={statsTab === key ? 'default' : 'outline'} onClick={() => setStatsTab(key)}>
                    {key.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {visibleStatsData.length > 0 ? (
              <StatsChart
                data={visibleStatsData}
                title={selectedRunId ? `Run ${selectedRunId.slice(0, 8)}` : 'Run'}
                type={statsTab}
                height={420}
                xDomain={xDomain}
                onDomainChange={setXDomain}
              />
            ) : (
              <p className="text-sm text-muted-foreground">当前没有可展示的性能数据。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">运行详情</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {loadError ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-700">{loadError}</p> : null}
            <div className="space-y-2 rounded border border-border p-3">
              <div><span className="text-muted-foreground">Run ID:</span> {selectedRunId || '-'}</div>
              <div><span className="text-muted-foreground">状态:</span> {STATUS_LABEL[activeStatus] ?? activeStatus}</div>
              <div><span className="text-muted-foreground">开始时间:</span> {formatTime(runDetail?.meta.start_time || selectedRun?.start_time)}</div>
              <div><span className="text-muted-foreground">结束时间:</span> {formatTime(runDetail?.meta.end_time || selectedRun?.end_time)}</div>
              <div><span className="text-muted-foreground">错误信息:</span> {activeError}</div>
            </div>

            <div className="space-y-2 rounded border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">日志摘要</p>
              {logSummary?.summary ? (
                <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-xs">{logSummary.summary}</pre>
              ) : (
                <p className="text-xs text-muted-foreground">暂无日志摘要。</p>
              )}
              {logSummary?.errors?.length ? (
                <ul className="list-inside list-disc text-xs text-red-600">
                  {logSummary.errors.map((line) => <li key={line}>{line}</li>)}
                </ul>
              ) : null}
            </div>

            {runDetail?.config ? (
              <details className="rounded border border-border p-3">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">执行配置</summary>
                <pre className="mt-3 max-h-[280px] overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(runDetail.config, null, 2)}</pre>
              </details>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
