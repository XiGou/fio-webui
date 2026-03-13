import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatsChart } from '@/components/StatsChart'
import type { LogSummary, RunState, StatsDataPoint, WsMessage } from '@/types/api'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  finished: 'Finished',
  error: 'Error',
}

export function RealtimeMonitorPage() {
  const [searchParams] = useSearchParams()
  const runIdFromUrl = searchParams.get('runId') || ''
  const navigate = useNavigate()

  const [state, setState] = useState<RunState | null>(null)
  const [logSummary, setLogSummary] = useState<LogSummary | null>(null)
  const [statsData, setStatsData] = useState<StatsDataPoint[]>([])
  const [statsTab, setStatsTab] = useState<'iops' | 'bw' | 'lat'>('iops')
  const wsRef = useRef<WebSocket | null>(null)

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

  const activeRunId = useMemo(() => runIdFromUrl || state?.id || '', [runIdFromUrl, state?.id])

  useEffect(() => {
    fetch('/api/status').then((r) => r.ok && r.json()).then((s) => s && setState(s as RunState)).catch(() => {})

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const port = window.location.port
    const wsPort = port === '5173' || port === '5174' ? '8080' : port
    const wsHost = port === '5173' || port === '5174' ? `${host}:${wsPort}` : window.location.host
    const ws = new WebSocket(`${protocol}//${wsHost}/api/events`)
    wsRef.current = ws

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as WsMessage
        if (msg.type === 'status') setState(msg.data as RunState)
        if (msg.type === 'stats' && msg.data) {
          const point = normalizeStatsPoint(msg.data)
          if (!point) return
          setStatsData((prev) => [...prev, point].slice(-1000))
        }
      } catch {
        // ignore
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [normalizeStatsPoint])

  useEffect(() => {
    if (!activeRunId) return
    fetch(`/api/runs/${activeRunId}/stats`)
      .then((r) => (r.ok ? r.json() : []))
      .then((arr: unknown) => {
        if (!Array.isArray(arr)) return
        const points = arr.map(normalizeStatsPoint).filter(Boolean) as StatsDataPoint[]
        if (points.length > 0) setStatsData(points)
      })
      .catch(() => {})

    fetch(`/api/runs/${activeRunId}/log-summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => data && setLogSummary(data as LogSummary))
      .catch(() => {})
  }, [activeRunId, normalizeStatsPoint])

  const stop = async () => {
    await fetch('/api/stop', { method: 'POST' }).catch(() => {})
  }

  const statusLabel = state ? STATUS_LABEL[state.status] ?? state.status : 'Idle'

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">实时监控</h1>
          <p className="text-xs text-muted-foreground">全屏监控当前运行任务状态、性能曲线与日志摘要</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => navigate('/')}>返回工作流</Button>
          <Button variant="outline" onClick={() => navigate('/history')}>任务管理</Button>
          <Button variant="secondary" onClick={stop}>停止任务</Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">运行状态</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Run ID:</span> {activeRunId || '-'}</p>
            <p><span className="text-muted-foreground">Status:</span> {statusLabel}</p>
            <p><span className="text-muted-foreground">Started:</span> {state?.start_time || '-'}</p>
            {state?.error ? <p className="text-red-500">{state.error}</p> : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">性能曲线</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-3 flex gap-2 text-xs">
              {(['iops', 'bw', 'lat'] as const).map((k) => (
                <Button key={k} size="sm" variant={statsTab === k ? 'default' : 'outline'} onClick={() => setStatsTab(k)}>{k.toUpperCase()}</Button>
              ))}
            </div>
            {statsData.length > 0 ? <StatsChart data={statsData} title="实时性能" type={statsTab} height={320} /> : <p className="text-sm text-muted-foreground">暂无性能数据</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">日志摘要</CardTitle></CardHeader>
          <CardContent>
            {logSummary?.summary ? <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-xs">{logSummary.summary}</pre> : <p className="text-sm text-muted-foreground">暂无日志摘要</p>}
            {logSummary?.errors?.length ? (
              <ul className="mt-3 list-inside list-disc text-xs text-red-500">
                {logSummary.errors.map((line) => <li key={line}>{line}</li>)}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
