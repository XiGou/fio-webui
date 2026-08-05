import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, ArrowLeft, CircleStop, Clock3, FileChartColumn, LocateFixed, Radio, RefreshCw, Server, Terminal, Timer, Wifi, WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatsChart } from '@/components/StatsChart'
import { MetricSeriesControls } from '@/components/MetricSeriesControls'
import { DEFAULT_LIVE_TIME_WINDOW, getLiveChartDomain, type ChartDomain, type LiveTimeWindow } from '@/lib/chartRanges'
import { getLiveMetricJobs, type LatencyStatistic, type MetricDirection } from '@/lib/metricSeries'
import { cn } from '@/lib/utils'
import type { FioTaskList, JobStatsDataPoint, LogSummary, RunRecord, RunState, StatsDataPoint, WsMessage } from '@/types/api'

const STATUS_LABEL: Record<string, string> = {
  idle: '空闲',
  running: '运行中',
  finished: '已完成',
  error: '异常',
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
  const normalizeJob = (value: unknown): JobStatsDataPoint | null => {
    if (!value || typeof value !== 'object') return null
    const job = value as Record<string, unknown>
    const name = typeof job.name === 'string' ? job.name : ''
    if (!name) return null
    const stageIndex = num(job.stageIndex)
    return {
      key: typeof job.key === 'string' && job.key ? job.key : `${stageIndex}:${name}`,
      name,
      stageIndex,
      iops: num(job.iops), iopsRead: num(job.iopsRead), iopsWrite: num(job.iopsWrite),
      bw: num(job.bw), bwRead: num(job.bwRead), bwWrite: num(job.bwWrite),
      latMean: num(job.latMean), latP95: num(job.latP95), latP99: num(job.latP99), latMax: num(job.latMax),
      latMeanRead: num(job.latMeanRead), latP95Read: num(job.latP95Read), latP99Read: num(job.latP99Read), latMaxRead: num(job.latMaxRead),
      latMeanWrite: num(job.latMeanWrite), latP95Write: num(job.latP95Write), latP99Write: num(job.latP99Write), latMaxWrite: num(job.latMaxWrite),
    }
  }
  return {
    time,
    stageIndex: num(record.stageIndex),
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
    latMeanRead: num(record.latMeanRead),
    latP95Read: num(record.latP95Read),
    latP99Read: num(record.latP99Read),
    latMaxRead: num(record.latMaxRead),
    latMeanWrite: num(record.latMeanWrite),
    latP95Write: num(record.latP95Write),
    latP99Write: num(record.latP99Write),
    latMaxWrite: num(record.latMaxWrite),
    jobs: Array.isArray(record.jobs) ? record.jobs.map(normalizeJob).filter(Boolean) as JobStatsDataPoint[] : [],
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
  const [realtimeLogs, setRealtimeLogs] = useState<string[]>([])
  const [loadError, setLoadError] = useState('')
  const [wsStatus, setWsStatus] = useState<WsStatus>('closed')
  const [statsTab, setStatsTab] = useState<'iops' | 'bw' | 'lat'>('iops')
  const [timeRange, setTimeRange] = useState<LiveTimeWindow>(DEFAULT_LIVE_TIME_WINDOW)
  const [isFollowing, setIsFollowing] = useState(true)
  const [xDomain, setXDomain] = useState<ChartDomain | null>(null)
  const [selectedJobKeys, setSelectedJobKeys] = useState<string[]>([])
  const [directions, setDirections] = useState<MetricDirection[]>(['read', 'write'])
  const [latencyStatistics, setLatencyStatistics] = useState<LatencyStatistic[]>(['mean', 'p99'])

  const selectedRunIdRef = useRef(selectedRunId)
  const runStateRef = useRef<RunState | null>(runState)
  const mountedRef = useRef(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastLiveStatsAtRef = useRef(0)
  const statsRefreshInFlightRef = useRef(false)
  const consoleScrollRef = useRef<HTMLDivElement>(null)
  const previousMetricJobKeysRef = useRef<string[]>([])

  useEffect(() => {
    const consoleElement = consoleScrollRef.current
    if (consoleElement) consoleElement.scrollTop = consoleElement.scrollHeight
  }, [realtimeLogs])

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId
  }, [selectedRunId])

  useEffect(() => {
    runStateRef.current = runState
  }, [runState])

  const syncSelectedRunId = useCallback((runId: string) => {
    lastLiveStatsAtRef.current = 0
    setIsFollowing(true)
    setXDomain(null)
    setStatsData([])
    setSelectedJobKeys([])
    previousMetricJobKeysRef.current = []
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
      const [detailRes, statsRes, logRes, outputRes] = await Promise.all([
        fetch(`/api/runs/${runId}`),
        fetch(`/api/runs/${runId}/stats`),
        fetch(`/api/runs/${runId}/log-summary`),
        fetch(`/api/runs/${runId}/output`),
      ])

      if (!detailRes.ok) {
        setRunDetail(null)
        setStatsData([])
        setLogSummary(null)
        setRealtimeLogs([])
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

      if (outputRes.ok) {
        const text = await outputRes.text()
        setRealtimeLogs(text.split('\n').filter(l => l.trim() !== ''))
      } else {
        setRealtimeLogs([])
      }
    } catch {
      setRunDetail(null)
      setStatsData([])
      setLogSummary(null)
      setRealtimeLogs([])
      setLoadError('加载运行详情失败：网络错误')
    }
  }, [])

  const fetchRunStats = useCallback(async (runId: string) => {
    if (!runId || statsRefreshInFlightRef.current) return
    statsRefreshInFlightRef.current = true
    try {
      const response = await fetch(`/api/runs/${runId}/stats`)
      if (!response.ok || selectedRunIdRef.current !== runId) return
      const raw = (await response.json()) as unknown
      if (!Array.isArray(raw) || selectedRunIdRef.current !== runId) return
      setStatsData(raw.map(normalizeStatsPoint).filter(Boolean) as StatsDataPoint[])
    } catch {
      // WebSocket remains the primary path; the next interval retries the snapshot.
    } finally {
      statsRefreshInFlightRef.current = false
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
  const liveDomain = useMemo(() => getLiveChartDomain(statsData, timeRange), [statsData, timeRange])
  const activeDomain = isFollowing ? liveDomain : xDomain ?? liveDomain
  const runningRuns = useMemo(() => runs.filter((item) => item.status === 'running'), [runs])
  const metricJobs = useMemo(() => getLiveMetricJobs(statsData), [statsData])

  useEffect(() => {
    const nextKeys = metricJobs.map((job) => job.key)
    const previousKeys = previousMetricJobKeysRef.current
    setSelectedJobKeys((current) => {
      const wasShowingAll = current.length === 0 || previousKeys.length === 0 || previousKeys.every((key) => current.includes(key))
      if (wasShowingAll) return nextKeys
      const valid = current.filter((key) => nextKeys.includes(key))
      return valid.length ? valid : nextKeys.slice(0, 1)
    })
    previousMetricJobKeysRef.current = nextKeys
  }, [metricJobs])

  useEffect(() => {
    if (!selectedRunId) return
    fetchRunSnapshot(selectedRunId)
  }, [fetchRunSnapshot, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || isSelectedRunning) return
    const timer = window.setInterval(() => {
      fetchRunSnapshot(selectedRunId)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [fetchRunSnapshot, isSelectedRunning, selectedRunId])

  useEffect(() => {
    if (!selectedRunId || !isSelectedRunning) return
    const refreshIfStale = () => {
      if (Date.now() - lastLiveStatsAtRef.current >= 2500) fetchRunStats(selectedRunId)
    }
    refreshIfStale()
    const timer = window.setInterval(refreshIfStale, 1000)
    return () => window.clearInterval(timer)
  }, [fetchRunStats, isSelectedRunning, selectedRunId])

  useEffect(() => {
    let backoff = 1000
    const maxBackoff = 10000
    const wsUrl = buildWsUrl()
    let stale = false

    const connect = () => {
      if (stale || !mountedRef.current) return
      setWsStatus('connecting')
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        if (stale) {
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
            const prevStatus = runStateRef.current?.status
            setRunState(nextState)

            // Only refresh runs list if status changed to/from running
            if (prevStatus !== nextState.status) {
              fetchRuns()
            }

            if (!selectedRunIdRef.current && nextState.id) {
              syncSelectedRunId(nextState.id)
            }
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
              if (nextState.status !== 'running' && prevStatus === 'running') {
                fetchRunSnapshot(nextState.id)
              }
            }
          }

          if (msg.type === 'stats' && selectedRunIdRef.current && runStateRef.current?.id === selectedRunIdRef.current) {
            const point = normalizeStatsPoint(msg.data)
            if (!point) return
            lastLiveStatsAtRef.current = Date.now()
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

          if (msg.type === 'output' && selectedRunIdRef.current && runStateRef.current?.id === selectedRunIdRef.current) {
            const line = msg.data as string
            setRealtimeLogs((prev) => {
              const next = [...prev, line]
              return next.length > 1000 ? next.slice(next.length - 1000) : next
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
        if (!mountedRef.current || reconnectTimerRef.current != null) return
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
  }, [fetchRunSnapshot, fetchRuns, syncSelectedRunId])

  const onSelectRun = (runId: string) => {
    syncSelectedRunId(runId)
  }

  const selectTimeRange = (range: LiveTimeWindow) => {
    setTimeRange(range)
    setIsFollowing(true)
    setXDomain(null)
  }

  const showLatest = () => {
    setIsFollowing(true)
    setXDomain(null)
  }

  const inspectDomain = useCallback((domain: ChartDomain) => {
    setXDomain(domain)
    setIsFollowing(false)
  }, [])

  const toggleJob = (key: string) => setSelectedJobKeys((current) => current.includes(key)
    ? current.length > 1 ? current.filter((item) => item !== key) : current
    : [...current, key])
  const toggleDirection = (direction: MetricDirection) => setDirections((current) => current.includes(direction)
    ? current.length > 1 ? current.filter((item) => item !== direction) : current
    : [...current, direction])
  const toggleLatencyStatistic = (statistic: LatencyStatistic) => setLatencyStatistics((current) => current.includes(statistic)
    ? current.length > 1 ? current.filter((item) => item !== statistic) : current
    : [...current, statistic])

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
  const latest = statsData[statsData.length - 1]
  return (
    <div className="min-h-full bg-background">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-border px-4 py-2 lg:px-6">
        <Button size="icon" variant="ghost" onClick={() => navigate('/')} title="返回编排" aria-label="返回编排"><ArrowLeft /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h1 className="truncate text-base font-semibold">运行监控</h1><Badge tone={activeStatus === 'running' ? 'info' : activeStatus === 'error' ? 'danger' : 'success'}>{STATUS_LABEL[activeStatus] ?? activeStatus}</Badge></div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">{selectedRunId || 'NO ACTIVE RUN'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={wsStatus === 'open' ? 'success' : wsStatus === 'connecting' ? 'warning' : 'neutral'}>{wsStatus === 'open' ? <Wifi className="mr-1 h-3 w-3" /> : <WifiOff className="mr-1 h-3 w-3" />}{wsStatus === 'open' ? 'LIVE' : wsStatus.toUpperCase()}</Badge>
          <Button variant="outline" onClick={() => selectedRunId && navigate(`/history?runId=${selectedRunId}`)} disabled={!selectedRunId}><FileChartColumn />生成报告</Button>
          <Button variant="destructive" onClick={stop} disabled={!isSelectedRunning}><CircleStop />停止</Button>
        </div>
      </header>

      <section className="border-b border-border bg-workbench px-4 py-3 lg:px-6">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="mr-1 flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase text-muted-foreground"><Server className="h-3.5 w-3.5" />Runs</span>
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className={cn('min-w-[174px] border bg-background px-3 py-2 text-left', run.id === selectedRunId ? 'border-primary shadow-sm' : 'border-border hover:border-muted-foreground/50')}
              onClick={() => onSelectRun(run.id)}
            >
              <span className="flex items-center justify-between gap-2"><strong className="font-mono text-[11px]">{run.id.slice(0, 12)}</strong><span className={cn('h-2 w-2 rounded-full', run.status === 'running' ? 'bg-cyan-500' : run.status === 'error' ? 'bg-red-500' : 'bg-emerald-600')} /></span>
              <span className="mt-1 block truncate text-[10px] text-muted-foreground">{formatTime(run.start_time)}</span>
            </button>
          ))}
          {runs.length === 0 ? <span className="text-xs text-muted-foreground">暂无运行记录</span> : null}
        </div>
      </section>

      {loadError ? <div className="border-b border-red-200 bg-red-50 px-6 py-2 text-xs text-red-800">{loadError}</div> : null}

      <section className="grid border-b border-border sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'IOPS', value: latest ? latest.iops.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '-', meta: `R ${latest?.iopsRead.toFixed(0) ?? '-'} / W ${latest?.iopsWrite.toFixed(0) ?? '-'}`, icon: Activity },
          { label: '带宽', value: latest ? `${latest.bw.toFixed(1)} MiB/s` : '-', meta: `R ${latest?.bwRead.toFixed(1) ?? '-'} / W ${latest?.bwWrite.toFixed(1) ?? '-'}`, icon: Radio },
          { label: 'P99 延迟', value: latest ? `${latest.latP99.toFixed(2)} ms` : '-', meta: `R ${latest?.latP99Read.toFixed(2) ?? '-'} / W ${latest?.latP99Write.toFixed(2) ?? '-'} ms`, icon: Timer },
          { label: '数据来源', value: isSelectedRunning ? 'fio stdout' : 'stats.jsonl', meta: `${statsData.length} samples · ${runningRuns.length} active`, icon: Server },
        ].map(({ label, value, meta, icon: Icon }) => (
          <div key={label} className="flex min-h-24 items-center gap-3 border-b border-border px-5 py-4 sm:border-r xl:border-b-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0"><p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 truncate font-mono text-lg font-semibold tabular-nums">{value}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{meta}</p></div>
          </div>
        ))}
      </section>

      <div className="grid min-h-[520px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 border-b border-border p-4 lg:p-6 xl:border-b-0 xl:border-r">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex border border-border bg-muted/50 p-0.5" role="tablist" aria-label="性能指标">
              {(['iops', 'bw', 'lat'] as const).map((key) => <button key={key} className={cn('h-7 min-w-14 px-2 text-[11px] font-semibold uppercase', statsTab === key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} type="button" role="tab" aria-selected={statsTab === key} onClick={() => setStatsTab(key)}>{key}</button>)}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />时间窗</span>
              <div className="flex border border-border bg-muted/50 p-0.5" role="group" aria-label="图表时间窗口">
                {(['30s', '1m', '5m', '15m', 'all'] as const).map((range) => <button key={range} className={cn('h-7 min-w-10 px-2 text-[10px] font-semibold uppercase', timeRange === range ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')} type="button" aria-pressed={timeRange === range} onClick={() => selectTimeRange(range)}>{range === 'all' ? '全部' : range}</button>)}
              </div>
            </div>
            <span className={cn('flex h-7 items-center gap-1.5 border px-2 text-[10px] font-semibold', isFollowing ? 'border-cyan-200 bg-cyan-50 text-cyan-800' : 'border-border bg-muted text-muted-foreground')}><span className={cn('h-1.5 w-1.5 rounded-full', isFollowing ? 'bg-cyan-600' : 'bg-muted-foreground')} />{isFollowing ? '跟随最新' : '查看历史'}</span>
            {!isFollowing ? <Button size="sm" variant="outline" onClick={showLatest}><LocateFixed />回到最新</Button> : null}
            <Button className="ml-auto" size="sm" variant="ghost" onClick={() => selectedRunId && fetchRunSnapshot(selectedRunId)}><RefreshCw />刷新</Button>
          </div>
          <div className="mb-3">
            <MetricSeriesControls
              jobs={metricJobs}
              selectedJobKeys={selectedJobKeys}
              directions={directions}
              latencyStatistics={latencyStatistics}
              showLatencyStatistics={statsTab === 'lat'}
              onToggleJob={toggleJob}
              onToggleDirection={toggleDirection}
              onToggleLatencyStatistic={toggleLatencyStatistic}
            />
          </div>
          {statsData.length > 0 ? <StatsChart data={statsData} title={`${statsTab.toUpperCase()} · ${selectedRunId.slice(0, 8)}`} type={statsTab} height={420} xDomain={activeDomain} followLatest={isFollowing} onUserDomainChange={inspectDomain} jobs={metricJobs} selectedJobKeys={selectedJobKeys} directions={directions} latencyStatistics={latencyStatistics} /> : <div className="flex h-[420px] flex-col items-center justify-center border border-dashed border-border text-center"><Activity className="mb-3 h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">等待性能采样</p><p className="mt-1 text-xs text-muted-foreground">运行开始后，fio status 数据会写入这里。</p></div>}
        </section>

        <aside className="space-y-5 p-4 lg:p-5">
          <section>
            <h2 className="mb-3 text-xs font-semibold">运行证据</h2>
            <dl className="grid grid-cols-[78px_1fr] gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">采集模式</dt><dd>{isSelectedRunning ? 'WebSocket + 轮询兜底' : '持久化快照'}</dd>
              <dt className="text-muted-foreground">开始</dt><dd>{formatTime(runDetail?.meta.start_time || selectedRun?.start_time)}</dd>
              <dt className="text-muted-foreground">结束</dt><dd>{formatTime(runDetail?.meta.end_time || selectedRun?.end_time)}</dd>
              <dt className="text-muted-foreground">错误</dt><dd className={activeError === '-' ? 'text-muted-foreground' : 'text-destructive'}>{activeError}</dd>
            </dl>
          </section>
          <section className="border-t border-border pt-4">
            <h2 className="mb-2 text-xs font-semibold">Job 实时数据</h2>
            {latest?.jobs?.length ? (
              <div className="divide-y divide-border border border-border">
                {latest.jobs.map((job) => (
                  <div key={job.key} className="px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2"><strong className="truncate text-xs">{job.name}</strong><span className="font-mono text-[9px] text-muted-foreground">OP {job.stageIndex + 1}</span></div>
                    <dl className="mt-2 grid grid-cols-[56px_1fr_1fr] gap-x-2 gap-y-1 font-mono text-[9px] tabular-nums">
                      <dt className="text-muted-foreground">IOPS</dt><dd>R {job.iopsRead.toFixed(0)}</dd><dd>W {job.iopsWrite.toFixed(0)}</dd>
                      <dt className="text-muted-foreground">BW</dt><dd>R {job.bwRead.toFixed(1)}</dd><dd>W {job.bwWrite.toFixed(1)} MiB/s</dd>
                      <dt className="text-muted-foreground">P99</dt><dd>R {job.latP99Read.toFixed(2)}</dd><dd>W {job.latP99Write.toFixed(2)} ms</dd>
                    </dl>
                  </div>
                ))}
              </div>
            ) : <p className="text-xs text-muted-foreground">旧运行仅包含聚合指标。</p>}
          </section>
          <section className="border-t border-border pt-4">
            <h2 className="mb-2 text-xs font-semibold">日志摘要</h2>
            {logSummary?.summary ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap bg-muted p-3 text-[10px] leading-5">{logSummary.summary}</pre> : <p className="text-xs text-muted-foreground">运行完成后生成摘要。</p>}
            {logSummary?.errors?.length ? <ul className="mt-2 space-y-1 text-xs text-destructive">{logSummary.errors.map((line) => <li key={line}>{line}</li>)}</ul> : null}
          </section>
          {runDetail?.config ? <details className="border-t border-border pt-4"><summary className="cursor-pointer text-xs font-semibold">编译配置</summary><pre className="mt-3 max-h-64 overflow-auto bg-muted p-3 text-[10px]">{JSON.stringify(runDetail.config, null, 2)}</pre></details> : null}
        </aside>
      </div>

      <section className="border-t border-border bg-[#111714] text-[#d7e3dc]">
        <header className="flex h-11 items-center justify-between border-b border-white/10 px-4 lg:px-6"><h2 className="flex items-center gap-2 font-mono text-xs font-semibold"><Terminal className="h-4 w-4 text-emerald-400" />FIO STDOUT</h2><div className="flex items-center gap-3 text-[10px] text-[#92a49a]"><span>{realtimeLogs.length} lines</span><Button variant="ghost" size="sm" className="text-[#b9c7bf] hover:bg-white/10 hover:text-white" onClick={() => setRealtimeLogs([])}>清空</Button></div></header>
        <div ref={consoleScrollRef} className="h-64 overflow-auto px-4 py-3 font-mono text-[10px] leading-5 lg:px-6">
          {realtimeLogs.length ? realtimeLogs.map((line, index) => <div key={`${index}-${line.slice(0, 12)}`} className="whitespace-pre-wrap"><span className="mr-3 select-none text-[#5f7167]">{String(index + 1).padStart(4, '0')}</span>{line}</div>) : <p className="text-[#71847a]">等待 fio 输出...</p>}
        </div>
      </section>
    </div>
  )
}
