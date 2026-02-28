import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, Routes, Route } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ansiToHtml } from '@/lib/ansi'
import { StatsChart } from '@/components/StatsChart'
import { Layout } from '@/components/Layout'
import { PresetsPage } from '@/pages/PresetsPage'
import { HistoryPage } from '@/pages/HistoryPage'
import type { PresetWorkload } from '@/data/presets'
import type {
  DefaultsResponse,
  FioConfig,
  FioTask,
  FioTaskList,
  JobConfig,
  LogSummary,
  OptionsResponse,
  RunState,
  StatsDataPoint,
  TaskValidationResponse,
  WsMessage,
} from '@/types/api'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  running: 'Running',
  finished: 'Finished',
  error: 'Error',
}

/** Fallback when backend is not running (e.g. dev without Go server) */
const FALLBACK_OPTIONS: OptionsResponse = {
  io_engines: ['libaio', 'io_uring', 'sync', 'posixaio'],
  rw_types: ['read', 'write', 'randread', 'randwrite', 'randrw', 'readwrite'],
  devices: [],
}

type JobDraft = JobConfig & { _id: string; _collapsed: boolean; _stonewallAfter?: boolean } // If true, insert stonewall after this job. JobConfig may include runtime and ioengine overrides.

type TaskDraft = FioTask & { _id: string; _collapsed: boolean; _validating?: boolean; _validationErrors?: TaskValidationResponse }

function newJobDraft(base?: Partial<JobConfig>): JobDraft {
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 7)
  return {
    _id: `job_${now}_${rand}`,
    _collapsed: false,
    name: base?.name ?? 'job1',
    filename: base?.filename ?? '/tmp/fio-test',
    rw: base?.rw ?? 'randread',
    bs: base?.bs ?? '4k',
    size: base?.size ?? '1G',
    numjobs: base?.numjobs ?? 1,
    iodepth: base?.iodepth ?? 32,
    rwmixread: base?.rwmixread ?? 70,
    rate: base?.rate ?? '',
  }
}

function newTaskDraft(base?: Partial<FioTask>): TaskDraft {
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 7)
  return {
    _id: `task_${now}_${rand}`,
    _collapsed: false,
    name: base?.name || `task${Date.now()}`,
    global: base?.global || {
      ioengine: 'libaio',
      direct: true,
      runtime: 60,
      time_based: true,
      group_reporting: true,
      log_avg_msec: 500,
      output_format: 'json',
      status_interval: 1,
    },
    jobs: base?.jobs?.map((j) => ({ ...j })) || [newJobDraft({ name: 'job1' })],
  }
}

function presetToTaskDraft(preset: PresetWorkload): TaskDraft {
  const task = preset.task
  const jobs: JobDraft[] = task.jobs.map((j, i) => {
    const draft = newJobDraft(j) as JobDraft
    if (preset.stonewallBetweenJobs && i < task.jobs.length - 1) {
      draft._stonewallAfter = true
    }
    return draft
  })
  return newTaskDraft({ ...task, jobs })
}

function buildTaskList(tasks: TaskDraft[]): FioTaskList {
  return {
    tasks: tasks.map((t) => ({
      name: (t.name || `task`).trim() || `task`,
      global: {
        ioengine: t.global.ioengine,
        direct: t.global.direct,
        runtime: t.global.runtime,
        time_based: t.global.time_based ?? true,
        group_reporting: t.global.group_reporting ?? true,
        log_avg_msec: t.global.log_avg_msec,
        output_format: t.global.output_format,
        status_interval: t.global.status_interval,
      },
      jobs: t.jobs.map((j, idx) => ({
        name: (j.name || `job${idx + 1}`).trim() || `job${idx + 1}`,
        filename: j.filename,
        rw: j.rw,
        bs: j.bs,
        size: j.size,
        numjobs: j.numjobs,
        iodepth: j.iodepth,
        rwmixread: j.rwmixread,
        rate: j.rate || '',
        stonewallAfter: (j as JobDraft)._stonewallAfter || false,
        runtime: j.runtime,
        ioengine: j.ioengine,
      })),
    })),
  }
}

export default function App() {
  const [options, setOptions] = useState<OptionsResponse | null>(null)
  const [, setGlobal] = useState({
    ioengine: 'libaio',
    direct: true,
    runtime: 60,
    log_avg_msec: 500,
    // CLI args (docs/fio_doc.md) - keep compact defaults
    output_format: 'json',
    status_interval: 1,
  })
  const [tasks, setTasks] = useState<TaskDraft[]>([newTaskDraft({ name: 'task1' })])
  const [state, setState] = useState<RunState | null>(null)
  const [outputLines, setOutputLines] = useState<string[]>([]) // Transient messages (Starting, Stopping, Error)
  const [logSummary, setLogSummary] = useState<LogSummary | null>(null)
  const [statsData, setStatsData] = useState<StatsDataPoint[]>([])
  const [backendOffline, setBackendOffline] = useState(false)
  const [wsReconnecting, setWsReconnecting] = useState(false)
  const [logPanelOpen, setLogPanelOpen] = useState(false)
  const [statsPanelOpen, setStatsPanelOpen] = useState(false)
  const [statsTab, setStatsTab] = useState<'iops' | 'bw' | 'lat'>('iops')
  const outputEndRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/options').then((r) => (r.ok ? r.json() : Promise.reject(new Error('options')))) as Promise<OptionsResponse>,
      fetch('/api/defaults').then((r) => (r.ok ? r.json() : Promise.reject(new Error('defaults')))) as Promise<DefaultsResponse>,
    ])
      .then(([opt, def]) => {
        setBackendOffline(false)
        setOptions(opt)
        if (def?.global) {
          setGlobal((g) => ({
            ...g,
            ioengine: def.global.ioengine ?? g.ioengine,
            direct: def.global.direct ?? g.direct,
            runtime: def.global.runtime ?? g.runtime,
            log_avg_msec: def.global.log_avg_msec ?? g.log_avg_msec,
            output_format: def.global.output_format ?? g.output_format,
            status_interval: def.global.status_interval ?? g.status_interval,
          }))
        }
        if (def?.job && def?.global) {
          setTasks((prev) => {
            if (prev.length === 0) {
              return [newTaskDraft({ name: 'task1', global: def.global, jobs: [newJobDraft(def.job)] })]
            }
            const first = prev[0]
            if (first.jobs.length === 0) {
              return [{ ...first, global: def.global, jobs: [newJobDraft(def.job)] }, ...prev.slice(1)]
            }
            const firstJob = first.jobs[0] as JobDraft
            return [
              {
                ...first,
                global: def.global,
                jobs: [
                  {
                    ...firstJob,
                    name: def.job.name ?? firstJob.name,
                    filename: def.job.filename ?? firstJob.filename,
                    rw: def.job.rw ?? firstJob.rw,
                    bs: def.job.bs ?? firstJob.bs,
                    size: def.job.size ?? firstJob.size,
                    numjobs: def.job.numjobs ?? firstJob.numjobs,
                    iodepth: def.job.iodepth ?? firstJob.iodepth,
                    rwmixread: def.job.rwmixread ?? firstJob.rwmixread,
                    rate: def.job.rate ?? firstJob.rate,
                  },
                  ...first.jobs.slice(1),
                ],
              },
              ...prev.slice(1),
            ]
          })
        }
      })
      .catch(() => {
        setBackendOffline(true)
        setOptions(FALLBACK_OPTIONS)
      })
  }, [])

  const normalizeStatsPoint = useCallback((raw: unknown): StatsDataPoint | null => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const time = Number(r.time)
    if (!Number.isFinite(time) || time < 0) return null

    const num = (v: unknown) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : 0
    }

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

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.hostname
    const port = window.location.port
    // In dev (Vite 5173/5174), connect directly to backend to avoid WS proxy issues
    const wsPort = port === '5173' || port === '5174' ? '8080' : port
    const wsHost = port === '5173' || port === '5174' ? `${host}:${wsPort}` : window.location.host
    const wsUrl = `${protocol}//${wsHost}/api/events`
    let backoff = 1000
    const maxBackoff = 10000

    const connect = () => {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setWsReconnecting(false)
        backoff = 1000
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WsMessage
          if (msg.type === 'status') setState(msg.data as RunState)
          if (msg.type === 'stats' && msg.data) {
            const point = normalizeStatsPoint(msg.data)
            if (!point) return
            setStatsData((prev) => {
              const last = prev.length > 0 ? prev[prev.length - 1].time : 0
              if (point.time < last) return prev
              const next = [...prev, point]
              return next.slice(-1000)
            })
          }
        } catch (_) {}
      }

      ws.onclose = () => {
        wsRef.current = null
        if (!mountedRef.current || reconnectTimerRef.current != null) return
        setWsReconnecting(true)
        const delay = Math.min(backoff, maxBackoff)
        backoff = Math.min(backoff * 2, maxBackoff)
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null
          if (mountedRef.current) connect()
        }, delay)
      }
    }

    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const ws = wsRef.current
      if (ws) {
        wsRef.current = null
        // Only close if already open; avoid aborting during CONNECTING (prevents
        // "WebSocket is closed before the connection is established" on unmount).
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
          ws.close()
        }
      }
      setWsReconnecting(false)
    }
  }, [])

  // Load historical stats (for current run). Returns data or null.
  const fetchStatsHistory = useCallback(async (): Promise<StatsDataPoint[] | null> => {
    try {
      const res = await fetch('/api/stats')
      if (!res.ok) return null
      const data = (await res.json()) as unknown
      if (!Array.isArray(data) || data.length === 0) return null
      const normalized = data.map(normalizeStatsPoint).filter(Boolean) as StatsDataPoint[]
      return normalized.length > 0 ? normalized : null
    } catch {
      return null
    }
  }, [normalizeStatsPoint])

  useEffect(() => {
    let canceled = false
    fetchStatsHistory().then((data) => {
      if (!canceled && data) setStatsData(data)
    })
    return () => { canceled = true }
  }, [fetchStatsHistory])

  // When opening Status panel, refetch history so we show persisted data immediately.
  useEffect(() => {
    if (statsPanelOpen) {
      fetchStatsHistory().then((data) => data && setStatsData(data))
    }
  }, [statsPanelOpen, fetchStatsHistory])

  // Fetch log summary when Log panel opens (server-parsed summary + errors only)
  const fetchLogSummary = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/runs/${runId}/log-summary`)
      if (!res.ok) return
      const data = (await res.json()) as LogSummary
      setLogSummary(data)
    } catch {
      setLogSummary(null)
    }
  }, [])

  useEffect(() => {
    if (!logPanelOpen) return
    const runId = state?.id
    if (runId) {
      fetchLogSummary(runId)
      if (state?.status === 'running') {
        const id = setInterval(() => fetchLogSummary(runId), 2000)
        return () => clearInterval(id)
      }
    } else {
      setLogSummary(null)
    }
  }, [logPanelOpen, state?.id, state?.status, fetchLogSummary])

  useEffect(() => {
    if (logPanelOpen) {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [outputLines, logSummary, logPanelOpen])

  const location = useLocation()
  const navigate = useNavigate()

  // Apply preset when navigating from Presets page with state.preset
  // Apply runConfig when navigating from History page with state.runConfig
  useEffect(() => {
    const preset = location.state?.preset as PresetWorkload | undefined
    const runConfig = location.state?.runConfig as FioTaskList | undefined
    if (preset) {
      const draft = presetToTaskDraft(preset)
      setTasks((prev) => {
        const collapsedPrev = prev.map((t) => ({ ...t, _collapsed: true }))
        return [...collapsedPrev, draft]
      })
      navigate('/', { replace: true, state: {} })
    } else if (runConfig?.tasks?.length) {
      const drafts: TaskDraft[] = runConfig.tasks.map((t) => {
        const jobs = t.jobs.map((j) => {
          const d = newJobDraft(j) as JobDraft
          d._stonewallAfter = j.stonewallAfter ?? false
          return d
        })
        return newTaskDraft({ name: t.name, global: t.global, jobs })
      })
      setTasks(drafts.map((d) => ({ ...d, _collapsed: true })))
      navigate('/', { replace: true, state: {} })
    }
  }, [location.state, navigate])

  const run = state?.status === 'running'
  const start = async () => {
    const taskList = buildTaskList(tasks)
    if (taskList.tasks.length === 0) return
    if (taskList.tasks.every((t) => t.jobs.length === 0)) return
    setOutputLines(['Starting test...'])
    setLogSummary(null)
    setStatsData([]) // Clear previous stats
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(taskList),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setOutputLines((prev) => [...prev, `Error: ${(err as { error?: string }).error || res.statusText}`])
    }
  }

  const validateTask = async (taskId: string) => {
    const task = tasks.find((t) => t._id === taskId)
    if (!task) return

    setTasks((prev) => prev.map((t) => (t._id === taskId ? { ...t, _validating: true } : t)))

    const config: FioConfig = {
      global: task.global,
      jobs: task.jobs.map((j) => ({
        name: j.name,
        filename: j.filename,
        rw: j.rw,
        bs: j.bs,
        size: j.size,
        numjobs: j.numjobs,
        iodepth: j.iodepth,
        rwmixread: j.rwmixread,
        rate: j.rate,
        stonewallAfter: (j as JobDraft)._stonewallAfter,
        runtime: j.runtime,
        ioengine: j.ioengine,
      })),
    }

    try {
      const res = await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const result = (await res.json()) as TaskValidationResponse
      setTasks((prev) =>
        prev.map((t) => (t._id === taskId ? { ...t, _validating: false, _validationErrors: result } : t))
      )
    } catch (err) {
      setTasks((prev) =>
        prev.map((t) =>
          t._id === taskId
            ? {
                ...t,
                _validating: false,
                _validationErrors: {
                  valid: false,
                  errors: [{ field: 'network', message: `Validation failed: ${err}` }],
                },
              }
            : t
        )
      )
    }
  }

  const stop = async () => {
    setOutputLines((prev) => [...prev, 'Stopping...'])
    await fetch('/api/stop', { method: 'POST' })
  }

  const totalJobCount = useMemo(() => tasks.reduce((sum, t) => sum + t.jobs.length, 0), [tasks])
  const runningLabel = useMemo(() => (state ? STATUS_LABEL[state.status] ?? state.status : 'Idle'), [state])

  // Task operations
  const toggleTaskCollapse = (taskId: string) => {
    setTasks((prev) => prev.map((t) => (t._id === taskId ? { ...t, _collapsed: !t._collapsed } : t)))
  }

  const addTaskAfter = (afterId?: string, template?: Partial<FioTask>) => {
    setTasks((prev) => {
      const draft = newTaskDraft(template)
      const collapsedPrev = prev.map((t) => ({ ...t, _collapsed: true }))
      if (!afterId) return [...collapsedPrev, draft]
      const idx = prev.findIndex((t) => t._id === afterId)
      if (idx < 0) return [...collapsedPrev, draft]
      return [...collapsedPrev.slice(0, idx + 1), draft, ...collapsedPrev.slice(idx + 1)]
    })
  }

  const duplicateTask = (taskId: string) => {
    const src = tasks.find((t) => t._id === taskId)
    if (!src) return
    addTaskAfter(taskId, {
      name: `${src.name}_copy`,
      global: { ...src.global },
      jobs: src.jobs.map((j) => ({ ...j })),
    })
  }

  const removeTask = (taskId: string) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t._id !== taskId)
      if (next.length === 0) return [newTaskDraft({ name: 'task1' })]
      return next
    })
  }

  const moveTask = (taskId: string, dir: -1 | 1) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t._id === taskId)
      const to = idx + dir
      if (idx < 0 || to < 0 || to >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(idx, 1)
      copy.splice(to, 0, item)
      return copy
    })
  }

  const updateTask = (taskId: string, patch: Partial<TaskDraft>) => {
    setTasks((prev) => prev.map((t) => (t._id === taskId ? { ...t, ...patch } : t)))
  }

  // Job operations within a task
  const collapseAllJobsExcept = (taskId: string, jobId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._id === taskId
          ? {
              ...t,
              jobs: t.jobs.map((j) => {
                const jd = j as JobDraft
                return { ...jd, _collapsed: jd._id !== jobId } as JobDraft
              }),
            }
          : t
      )
    )
  }

  const toggleJobCollapse = (taskId: string, jobId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._id === taskId
          ? {
              ...t,
              jobs: t.jobs.map((j) => {
                const jd = j as JobDraft
                return jd._id === jobId ? { ...jd, _collapsed: !jd._collapsed } : jd
              }),
            }
          : t
      )
    )
  }

  const addJobToTask = (taskId: string, afterJobId?: string, template?: Partial<JobConfig>) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._id !== taskId) return t
        const draft = newJobDraft(template)
        const collapsedJobs = t.jobs.map((j) => {
          const jd = j as JobDraft
          return { ...jd, _collapsed: true } as JobDraft
        })
        if (!afterJobId) return { ...t, jobs: [...collapsedJobs, draft] }
        const idx = t.jobs.findIndex((j) => (j as JobDraft)._id === afterJobId)
        if (idx < 0) return { ...t, jobs: [...collapsedJobs, draft] }
        return { ...t, jobs: [...collapsedJobs.slice(0, idx + 1), draft, ...collapsedJobs.slice(idx + 1)] }
      })
    )
  }

  const duplicateJobInTask = (taskId: string, jobId: string) => {
    const task = tasks.find((t) => t._id === taskId)
    if (!task) return
    const src = task.jobs.find((j) => (j as JobDraft)._id === jobId) as JobDraft | undefined
    if (!src) return
    addJobToTask(taskId, jobId, src)
  }

  const removeJobFromTask = (taskId: string, jobId: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._id !== taskId) return t
        const next = t.jobs.filter((j) => (j as JobDraft)._id !== jobId)
        if (next.length === 0) return { ...t, jobs: [newJobDraft({ name: 'job1' })] }
        return { ...t, jobs: next }
      })
    )
  }

  const moveJobInTask = (taskId: string, jobId: string, dir: -1 | 1) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._id !== taskId) return t
        const idx = t.jobs.findIndex((j) => (j as JobDraft)._id === jobId)
        const to = idx + dir
        if (idx < 0 || to < 0 || to >= t.jobs.length) return t
        const copy = [...t.jobs]
        const [item] = copy.splice(idx, 1)
        copy.splice(to, 0, item)
        return { ...t, jobs: copy }
      })
    )
  }

  const updateJobInTask = (taskId: string, jobId: string, patch: Partial<JobDraft>) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._id === taskId
          ? {
              ...t,
              jobs: t.jobs.map((j) => {
                const jd = j as JobDraft
                return jd._id === jobId ? { ...jd, ...patch } : jd
              }),
            }
          : t
      )
    )
  }

  const toggleStonewall = (taskId: string, jobId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._id === taskId
          ? {
              ...t,
              jobs: t.jobs.map((j) => {
                const jd = j as JobDraft
                return jd._id === jobId ? { ...jd, _stonewallAfter: !jd._stonewallAfter } : jd
              }),
            }
          : t
      )
    )
  }

  const showRwmix = (rw: string) =>
    rw === 'randrw' || rw === 'readwrite' || rw === 'rw' || rw === 'trimwrite' || rw === 'randtrimwrite'

  if (!options) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={
            <div className="space-y-5">
              <header className="flex items-center justify-between border-b border-border pb-4">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold text-foreground">FIO WebUI</h1>
          <p className="text-xs text-muted-foreground">
            {tasks.length} task{tasks.length > 1 ? 's' : ''} · {totalJobCount} job{totalJobCount > 1 ? 's' : ''} · sequential execution
          </p>
        </div>
        <div className="flex items-center gap-4">
          {wsReconnecting && (
            <span className="text-xs text-muted-foreground">Reconnecting…</span>
          )}
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Status:</span>
            <span className="font-medium text-foreground">{runningLabel}</span>
          </div>
        </div>
      </header>

      {backendOffline && (
        <div className="rounded border border-border bg-muted/50 px-4 py-3 text-sm text-foreground">
          <strong>Backend offline.</strong> Start server: <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs">./fio-webui</code> (default :8080). Using fallback options.
        </div>
      )}

      <Card>
          <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-medium">Configuration</CardTitle>
                <div className="flex gap-2">
                  <Button onClick={start} disabled={run} variant={run ? "secondary" : "default"}>
                    Start
                  </Button>
                  <Button onClick={stop} disabled={!run} variant="secondary">
                    Stop
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStatsPanelOpen(true)}
                  >
                    Status
                  </Button>
                </div>
              </div>
          </CardHeader>
          <CardContent className="space-y-6">

            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Fio Tasks</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => addTaskAfter(undefined, { name: `task${tasks.length + 1}` })}
                  >
                    Add Task
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {tasks.map((task, taskIdx) => {
                  const taskJobs = task.jobs as JobDraft[]
                  const validationErrors = task._validationErrors
                  const hasErrors = validationErrors?.errors && validationErrors.errors.length > 0

                  return (
                    <div key={task._id} className="rounded border border-border bg-card">
                      {/* Task Header */}
                      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
                          onClick={() => toggleTaskCollapse(task._id)}
                          title={task._collapsed ? 'Expand' : 'Collapse'}
                        >
                          <span className="w-5 text-xs font-medium text-muted-foreground">{taskIdx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="truncate text-sm font-medium text-foreground">
                                {task.name?.trim() || `task${taskIdx + 1}`}
                              </div>
                              {hasErrors && (
                                <span className="text-xs text-destructive">⚠ Invalid</span>
                              )}
                              {task._validating && (
                                <span className="text-xs text-muted-foreground">Validating...</span>
                              )}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {taskJobs.length} job{taskJobs.length > 1 ? 's' : ''} · {task.global.ioengine} · {task.global.runtime}s
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => validateTask(task._id)}
                            disabled={task._validating || taskJobs.length === 0}
                            title="Validate configuration"
                          >
                            {task._validating ? '...' : '✓ Test'}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveTask(task._id, -1)} disabled={taskIdx === 0}>
                            ↑
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveTask(task._id, 1)} disabled={taskIdx === tasks.length - 1}>
                            ↓
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => duplicateTask(task._id)}>
                            Copy
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => addTaskAfter(task._id, { name: `task${tasks.length + 1}` })}>
                            + After
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => removeTask(task._id)} disabled={tasks.length === 1}>
                            Remove
                          </Button>
                        </div>
                      </div>

                      {/* Validation Errors */}
                      {hasErrors && !task._collapsed && (
                        <div className="border-t border-destructive/20 bg-destructive/5 px-3 py-2">
                          <div className="text-xs font-medium text-destructive mb-1">Configuration Errors:</div>
                          <ul className="list-disc list-inside space-y-0.5 text-xs text-destructive/80">
                            {validationErrors?.errors?.map((err, i) => (
                              <li key={i}>{err.field}: {err.message}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {!task._collapsed && (
                        <div className="border-t border-border px-3 py-3 space-y-4">
                          {/* Task Name */}
                          <div className="space-y-1.5">
                            <Label className="text-xs">Task Name</Label>
                            <Input
                              className="h-9"
                              value={task.name}
                              onChange={(e) => updateTask(task._id, { name: e.target.value })}
                            />
                          </div>

                          {/* Global Settings for this Task */}
                          <div className="space-y-3">
                            <h4 className="text-xs font-medium text-foreground">Global Settings</h4>
                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                              <div className="space-y-2">
                                <Label className="text-xs">IO Engine</Label>
                                <Select value={task.global.ioengine} onValueChange={(v) => updateTask(task._id, { global: { ...task.global, ioengine: v } })}>
                                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {options.io_engines.map((e) => (
                                      <SelectItem key={e} value={e}>{e}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="flex items-center gap-2 pt-6">
                                <Switch checked={task.global.direct} onCheckedChange={(v) => updateTask(task._id, { global: { ...task.global, direct: v } })} />
                                <Label className="text-xs">Direct I/O</Label>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Runtime (sec)</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  className="h-9"
                                  value={task.global.runtime}
                                  onChange={(e) => updateTask(task._id, { global: { ...task.global, runtime: Number(e.target.value) || 60 } })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Log sampling (ms)</Label>
                                <Input
                                  type="number"
                                  min={100}
                                  className="h-9"
                                  value={task.global.log_avg_msec}
                                  onChange={(e) => updateTask(task._id, { global: { ...task.global, log_avg_msec: Number(e.target.value) || 500 } })}
                                />
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Output format</Label>
                                <Select
                                  value={task.global.output_format}
                                  onValueChange={(v) => updateTask(task._id, { global: { ...task.global, output_format: v } })}
                                >
                                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {['json', 'json+', 'normal', 'terse'].map((f) => (
                                      <SelectItem key={f} value={f}>{f}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs">Status interval (sec)</Label>
                                <Input
                                  type="number"
                                  min={0}
                                  className="h-9"
                                  value={task.global.status_interval}
                                  onChange={(e) => updateTask(task._id, { global: { ...task.global, status_interval: Number(e.target.value) || 0 } })}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Jobs in this Task */}
                          <div className="space-y-3 border-t border-border pt-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-medium text-foreground">Jobs</h4>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => addJobToTask(task._id, undefined, { name: `job${taskJobs.length + 1}` })}
                              >
                                Add Job
                              </Button>
                            </div>

                            <div className="space-y-2">
                              {taskJobs.map((j, jobIdx) => (
                                <div key={j._id}>
                                  {/* Stonewall divider */}
                                  {jobIdx > 0 && j._stonewallAfter && (
                                    <div className="relative my-4">
                                      <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-dashed border-muted-foreground/40"></div>
                                      </div>
                                      <div className="relative flex justify-center">
                                        <span className="bg-background px-2 text-xs font-medium text-muted-foreground">Stonewall — Wait for previous jobs</span>
                                      </div>
                                    </div>
                                  )}
                                  <div className="rounded border border-border bg-muted/30">
                                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                                      <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
                                        onClick={() => toggleJobCollapse(task._id, j._id)}
                                        title={j._collapsed ? 'Expand' : 'Collapse'}
                                      >
                                        <span className="w-5 text-xs font-medium text-muted-foreground">{jobIdx + 1}</span>
                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-medium text-foreground">
                                            {j.name?.trim() || `job${jobIdx + 1}`}
                                          </div>
                                          <div className="truncate text-xs text-muted-foreground">
                                            {j.rw} · {j.bs} · depth {j.iodepth} · {j.numjobs}× · {j.filename}
                                          </div>
                                        </div>
                                      </button>

                                      <div className="flex items-center gap-0.5">
                                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveJobInTask(task._id, j._id, -1)} disabled={jobIdx === 0}>
                                          ↑
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveJobInTask(task._id, j._id, 1)} disabled={jobIdx === taskJobs.length - 1}>
                                          ↓
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => duplicateJobInTask(task._id, j._id)}>
                                          Copy
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => addJobToTask(task._id, j._id, { name: `job${taskJobs.length + 1}` })}>
                                          + After
                                        </Button>
                                        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => removeJobFromTask(task._id, j._id)} disabled={taskJobs.length === 1}>
                                          Remove
                                        </Button>
                                      </div>
                                    </div>

                                    {!j._collapsed && (
                                      <div className="border-t border-border px-3 py-3">
                                        <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
                                          <Label className="text-xs font-medium">Job Parameters</Label>
                                          <div className="flex items-center gap-2">
                                            <Switch checked={j._stonewallAfter || false} onCheckedChange={() => toggleStonewall(task._id, j._id)} />
                                            <Label className="text-xs">Wait for previous jobs (stonewall)</Label>
                                          </div>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                          <div className="space-y-1.5">
                                            <Label className="text-xs">Job name</Label>
                                            <Input
                                              className="h-9"
                                              value={j.name}
                                              onChange={(e) => updateJobInTask(task._id, j._id, { name: e.target.value })}
                                              onFocus={() => collapseAllJobsExcept(task._id, j._id)}
                                            />
                                          </div>

                                          <div className="space-y-1.5 sm:col-span-2">
                                            <Label className="text-xs">Filename / Device</Label>
                                            <Input
                                              className="h-9"
                                              value={j.filename}
                                              onChange={(e) => updateJobInTask(task._id, j._id, { filename: e.target.value })}
                                              list={`devices-list-${task._id}`}
                                              placeholder="/dev/nvme0n1 or /path/to/file"
                                              onFocus={() => collapseAllJobsExcept(task._id, j._id)}
                                            />
                                            <datalist id={`devices-list-${task._id}`}>
                                              {options.devices.map((d) => <option key={d} value={d} />)}
                                            </datalist>
                                          </div>

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">IO Engine (override)</Label>
                                            <Select
                                              value={j.ioengine ?? '__global__'}
                                              onValueChange={(v) => updateJobInTask(task._id, j._id, { ioengine: v === '__global__' ? undefined : v })}
                                            >
                                              <SelectTrigger className="h-9">
                                                <SelectValue placeholder={`Use global (${task.global.ioengine})`} />
                                              </SelectTrigger>
                                              <SelectContent>
                                                <SelectItem value="__global__">Use global ({task.global.ioengine})</SelectItem>
                                                {options.io_engines.map((e) => (
                                                  <SelectItem key={e} value={e}>{e}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">Runtime (override, sec)</Label>
                                            <Input
                                              className="h-9"
                                              type="number"
                                              min={0}
                                              value={j.runtime ?? ''}
                                              onChange={(e) => updateJobInTask(task._id, j._id, { runtime: e.target.value === '' ? undefined : Number(e.target.value) || undefined })}
                                              placeholder={`Global: ${task.global.runtime}s`}
                                            />
                                          </div>

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">RW</Label>
                                            <Select value={j.rw} onValueChange={(v) => updateJobInTask(task._id, j._id, { rw: v })}>
                                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                              <SelectContent>
                                                {options.rw_types.map((r) => (
                                                  <SelectItem key={r} value={r}>{r}</SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">Block size</Label>
                                            <Input className="h-9" value={j.bs} onChange={(e) => updateJobInTask(task._id, j._id, { bs: e.target.value })} placeholder="4k" />
                                          </div>

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">Size</Label>
                                            <Input className="h-9" value={j.size} onChange={(e) => updateJobInTask(task._id, j._id, { size: e.target.value })} placeholder="1G" />
                                          </div>

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">Num jobs</Label>
                                            <Input
                                              className="h-9"
                                              type="number"
                                              min={1}
                                              value={j.numjobs}
                                              onChange={(e) => updateJobInTask(task._id, j._id, { numjobs: Number(e.target.value) || 1 })}
                                            />
                                          </div>

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">IO depth</Label>
                                            <Input
                                              className="h-9"
                                              type="number"
                                              min={1}
                                              value={j.iodepth}
                                              onChange={(e) => updateJobInTask(task._id, j._id, { iodepth: Number(e.target.value) || 1 })}
                                            />
                                          </div>

                                          {showRwmix(j.rw) && (
                                            <div className="space-y-1.5">
                                              <Label className="text-xs">Read %</Label>
                                              <Input
                                                className="h-9"
                                                type="number"
                                                min={0}
                                                max={100}
                                                value={j.rwmixread}
                                                onChange={(e) => updateJobInTask(task._id, j._id, { rwmixread: Number(e.target.value) || 0 })}
                                              />
                                            </div>
                                          )}

                                          <div className="space-y-1.5">
                                            <Label className="text-xs">Rate (optional)</Label>
                                            <Input
                                              className="h-9"
                                              value={j.rate ?? ''}
                                              onChange={(e) => updateJobInTask(task._id, j._id, { rate: e.target.value })}
                                              placeholder="1m, 500k"
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

      {/* Floating log button */}
      <button
        type="button"
        onClick={() => setLogPanelOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card shadow-lg hover:bg-muted transition-colors"
        title="View output log"
      >
        <span className="text-sm font-medium text-foreground">Log</span>
        {outputLines.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
            {outputLines.length > 99 ? '99+' : outputLines.length}
          </span>
        )}
      </button>

      {/* Log panel overlay */}
      {logPanelOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm"
            onClick={() => setLogPanelOpen(false)}
          />
          <div className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl border-l border-border bg-card shadow-xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-base font-medium text-foreground">日志摘要</h2>
                <Button variant="ghost" size="sm" onClick={() => setLogPanelOpen(false)}>
                  ×
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="space-y-4">
                  {outputLines.length > 0 && (
                    <div className="text-sm">
                      {outputLines.map((line, i) => (
                        <div key={i} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
                      ))}
                    </div>
                  )}
                  {logSummary && (
                    <>
                      {logSummary.summary && (
                        <div>
                          <div className="text-xs font-medium text-foreground mb-1">摘要</div>
                          <pre className="text-xs bg-muted/50 p-3 rounded overflow-auto max-h-48 whitespace-pre-wrap font-mono">
                            {logSummary.summary}
                          </pre>
                        </div>
                      )}
                      {logSummary.errors?.length ? (
                        <div>
                          <div className="text-xs font-medium text-destructive mb-1">错误</div>
                          <pre className="text-xs bg-destructive/10 p-3 rounded overflow-auto max-h-48 whitespace-pre-wrap font-mono text-destructive">
                            {logSummary.errors.join('\n')}
                          </pre>
                        </div>
                      ) : null}
                    </>
                  )}
                  {!logSummary && !outputLines.length && state?.id && (
                    <span className="text-muted-foreground">
                      {state?.status === 'running' ? '采集中…' : '暂无摘要'}
                    </span>
                  )}
                  {!state?.id && !outputLines.length && (
                    <span className="text-muted-foreground">启动任务后查看日志摘要</span>
                  )}
                  <div ref={outputEndRef} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Stats panel overlay */}
      {statsPanelOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
            onClick={() => setStatsPanelOpen(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-5xl h-[80vh] flex flex-col">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base font-medium">Run Status</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Real-time performance metrics for the current run
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setStatsPanelOpen(false)}>
                  ×
                </Button>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col pt-0">
                <div className="mb-3 flex gap-2 border-b border-border pb-2 text-xs">
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
                    Bandwidth
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
                    Latency
                  </button>
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  {statsData.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground text-center px-4">
                      <p>No stats yet. Start a run to see real-time metrics.</p>
                      <p className="text-xs">
                        Console errors like &quot;Receiving end does not exist&quot; come from a browser extension, not this app.
                      </p>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-[360px]">
                      {statsTab === 'iops' && (
                        <StatsChart data={statsData} title="IOPS" type="iops" height={360} />
                      )}
                      {statsTab === 'bw' && (
                        <StatsChart data={statsData} title="Bandwidth (MB/s)" type="bw" height={360} />
                      )}
                      {statsTab === 'lat' && (
                        <StatsChart data={statsData} title="Latency (ms)" type="lat" height={360} />
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
            </div>
          }
        />
        <Route path="history" element={<HistoryPage />} />
        <Route path="presets" element={<PresetsPage />} />
      </Route>
    </Routes>
  )
}
