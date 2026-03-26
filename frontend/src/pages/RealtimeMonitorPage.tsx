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

export function RealtimeMonitorPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const initialRunId = searchParams.get('runId') || ''
  const [selectedRunId, setSelectedRunId] = useState(initialRunId)
  const [runs, setRuns] = useState<RunRecord[]>([])
  const [runState, setRunState] = useState<RunState | null>(null)
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null)
  const [logSummary, setLogSummary] = useState<LogSummary | null>(null)
  const [statsData, setStatsData] = useState<StatsDataPoint[]>([])
  const [statsTab, setStatsTab] = useState<'iops' | 'bw' | 'lat'>('iops')
  const [timeRange, setTimeRange] = useState<'15m' | '1h' | '6h' | '24h' | 'all'>('all')
  const [xDomain, setXDomain] = useState<{ min: number; max: number } | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const selectedRunIdRef = useRef(selectedRunId)
  const runStateRef = useRef<RunState | null>(runState)

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId
  }, [selectedRunId])

  useEffect(() => {
    runStateRef.current = runState
  }, [runState])

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
      if (!selectedRunId && data.length > 0) {
        const running = data.find((item) => item.status === 'running')
        const pick = running ?? data[0]
        setSelectedRunId(pick.id)
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev)
          next.set('runId', pick.id)
          return next
        }, { replace: true })
      }
    } catch {
      // ignore
    }
  }, [selectedRunId, setSearchParams])

  useEffect(() => {
    fetchRuns()
    const timer = setInterval(fetchRuns, 3000)
    return () => clearInterval(timer)
  }, [fetchRuns])

  useEffect(() => {
    fetch('/api/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setRunState(data as RunState))
      .catch(() => {})

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const port = window.location.port
    const wsPort = port === '5173' || port === '5174' ? '8080' : port
    const wsHost = port === '5173' || port === '5174' ? `${host}:${wsPort}` : window.location.host
    const ws = new WebSocket(`${protocol}//${wsHost}/api/events`)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage
        if (msg.type === 'status') {
          const status = msg.data as RunState
          setRunState(status)
          if (!selectedRunId && status.id) {
            setSelectedRunId(status.id)
          }
          fetchRuns()
        } else if (msg.type === 'stats') {
          const status = runStateRef.current
          if (!status?.id || selectedRunIdRef.current && selectedRunIdRef.current !== status.id) return
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
        // ignore
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [fetchRuns, normalizeStatsPoint, selectedRunId])

  const activeRunId = selectedRunId || runState?.id || ''
  const activeRun = useMemo(() => runs.find((item) => item.id === activeRunId) ?? null, [runs, activeRunId])
  const visibleStatsData = useMemo(() => filterStatsByTimeRange(statsData, timeRange), [statsData, timeRange])

  const fetchRunData = useCallback(async (runId: string) => {
    if (!runId) return
    try {
      const [detailRes, statsRes, logRes] = await Promise.all([
        fetch(`/api/runs/${runId}`),
        fetch(`/api/runs/${runId}/stats`),
        fetch(`/api/runs/${runId}/log-summary`),
      ])

      if (detailRes.ok) {
        const detail = (await detailRes.json()) as RunDetail
        setRunDetail(detail)
      }

      if (statsRes.ok) {
        const raw = (await statsRes.json()) as unknown
        if (Array.isArray(raw)) {
          const points = raw.map(normalizeStatsPoint).filter(Boolean) as StatsDataPoint[]
          setStatsData(points)
        }
      }

      if (logRes.ok) {
        const summary = (await logRes.json()) as LogSummary
        setLogSummary(summary)
      }
    } catch {
      // ignore
    }
  }, [normalizeStatsPoint])

  useEffect(() => {
    if (!activeRunId) return
    fetchRunData(activeRunId)

    const isRunning = activeRun?.status === 'running' || runState?.id === activeRunId && runState?.status === 'running'
    if (!isRunning) return

    const timer = setInterval(() => {
      fetchRunData(activeRunId)
    }, 2000)
    return () => clearInterval(timer)
  }, [activeRunId, activeRun?.status, runState?.id, runState?.status, fetchRunData])

  const runningRuns = useMemo(() => runs.filter((item) => item.status === 'running'), [runs])

  const onSelectRun = (runId: string) => {
    setSelectedRunId(runId)
    setXDomain(null)
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('runId', runId)
      return next
    }, { replace: true })
  }

  const stop = async () => {
    await fetch('/api/stop', { method: 'POST' }).catch(() => {})
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-4">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">实时任务状态（全屏）</h1>
          <p className="text-xs text-muted-foreground">支持多任务切换查看，统计图优先展示，其他属性默认折叠</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/')}>返回工作流</Button>
          <Button variant="outline" onClick={() => navigate('/history')}>任务管理</Button>
          <Button variant="secondary" onClick={stop}>停止当前执行</Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">运行中任务（{runningRuns.length}） / 历史任务快速切换</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 overflow-auto pb-1">
            {runs.map((run) => (
              <button
                key={run.id}
                className={`min-w-[220px] rounded border px-3 py-2 text-left text-xs ${run.id === activeRunId ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'}`}
                onClick={() => onSelectRun(run.id)}
              >
                <p className="font-mono">{run.id.slice(0, 12)}</p>
                <p className={run.status === 'running' ? 'text-blue-600' : run.status === 'error' ? 'text-red-600' : 'text-muted-foreground'}>
                  {STATUS_LABEL[run.status] ?? run.status}
                </p>
                <p className="text-muted-foreground">{run.start_time}</p>
              </button>
            ))}
            {runs.length === 0 ? <p className="text-sm text-muted-foreground">暂无任务</p> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">性能统计图</CardTitle>
            <div className="flex gap-2 flex-wrap justify-end">
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
              <Button size="sm" variant="outline" onClick={() => setXDomain(null)}>重置缩放</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {visibleStatsData.length > 0 ? (
            <StatsChart
              data={visibleStatsData}
              title={`Run ${activeRunId.slice(0, 8)} 实时性能`}
              type={statsTab}
              height={Math.max(520, window.innerHeight - 320)}
              xDomain={xDomain}
              onDomainChange={setXDomain}
            />
          ) : (
            <p className="text-sm text-muted-foreground">当前时间范围内暂无性能数据</p>
          )}
        </CardContent>
      </Card>

      <details className="rounded-md border border-border bg-card p-3" open={false}>
        <summary className="cursor-pointer text-sm font-medium">其他属性</summary>
        <div className="mt-3 space-y-3 text-sm">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <div><span className="text-muted-foreground">Run ID:</span> {activeRunId || '-'}</div>
            <div><span className="text-muted-foreground">状态:</span> {activeRun ? STATUS_LABEL[activeRun.status] ?? activeRun.status : '-'}</div>
            <div><span className="text-muted-foreground">错误:</span> {activeRun?.error || '-'}</div>
          </div>

          <div>
            <p className="mb-1 text-xs text-muted-foreground">日志摘要</p>
            {logSummary?.summary ? <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-xs">{logSummary.summary}</pre> : <p className="text-xs text-muted-foreground">暂无摘要</p>}
            {logSummary?.errors?.length ? (
              <ul className="mt-2 list-inside list-disc text-xs text-red-500">
                {logSummary.errors.map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : null}
          </div>

          {runDetail?.config ? (
            <div>
              <p className="mb-1 text-xs text-muted-foreground">执行配置（JSON）</p>
              <pre className="max-h-[320px] overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(runDetail.config, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  )
}
