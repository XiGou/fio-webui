import { useEffect, useMemo, useRef, useState } from 'react'
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
import type {
  DefaultsResponse,
  FioConfig,
  JobConfig,
  OptionsResponse,
  RunState,
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

function buildConfig(
  global: {
    ioengine: string
    direct: boolean
    runtime: number
    log_avg_msec: number
    output_format: string
    status_interval: number
  },
  jobs: JobDraft[]
): FioConfig {
  // Check if any job has stonewall set
  const hasStonewall = jobs.some((j) => j._stonewallAfter)
  
  return {
    global: {
      ioengine: global.ioengine,
      direct: global.direct,
      runtime: global.runtime,
      time_based: true,
      group_reporting: true,
      log_avg_msec: global.log_avg_msec,
      output_format: global.output_format,
      status_interval: global.status_interval,
    },
    jobs: jobs.map((j, idx) => ({
      name: (j.name || `job${idx + 1}`).trim() || `job${idx + 1}`,
      filename: j.filename,
      rw: j.rw,
      bs: j.bs,
      size: j.size,
      numjobs: j.numjobs,
      iodepth: j.iodepth,
      rwmixread: j.rwmixread,
      rate: j.rate || '',
      stonewallAfter: j._stonewallAfter || false,
      runtime: j.runtime,
      ioengine: j.ioengine,
    })),
    sequential: !hasStonewall, // If stonewall is used, jobs are in one file, so sequential is not needed
  }
}

export default function App() {
  const [options, setOptions] = useState<OptionsResponse | null>(null)
  const [global, setGlobal] = useState({
    ioengine: 'libaio',
    direct: true,
    runtime: 60,
    log_avg_msec: 500,
    // CLI args (docs/fio_doc.md) - keep compact defaults
    output_format: 'json',
    status_interval: 1,
  })
  const [jobs, setJobs] = useState<JobDraft[]>([newJobDraft()])
  const [state, setState] = useState<RunState | null>(null)
  const [outputLines, setOutputLines] = useState<string[]>([])
  const [backendOffline, setBackendOffline] = useState(false)
  const [wsReconnecting, setWsReconnecting] = useState(false)
  const [logPanelOpen, setLogPanelOpen] = useState(false)
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
        if (def?.job) {
          setJobs((prev) => {
            if (prev.length === 0) return [newJobDraft(def.job)]
            const first = prev[0]
            return [
              {
                ...first,
                name: def.job.name ?? first.name,
                filename: def.job.filename ?? first.filename,
                rw: def.job.rw ?? first.rw,
                bs: def.job.bs ?? first.bs,
                size: def.job.size ?? first.size,
                numjobs: def.job.numjobs ?? first.numjobs,
                iodepth: def.job.iodepth ?? first.iodepth,
                rwmixread: def.job.rwmixread ?? first.rwmixread,
                rate: def.job.rate ?? first.rate,
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

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/events`
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
          if (msg.type === 'output' && msg.data) {
            const out = msg.data as { line?: string }
            const line = out.line
            if (typeof line === 'string') {
              setOutputLines((prev) => [...prev.slice(-99), line])
            }
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
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setWsReconnecting(false)
    }
  }, [])

  useEffect(() => {
    if (logPanelOpen) {
      outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [outputLines, logPanelOpen])

  const run = state?.status === 'running'
  const start = async () => {
    const config = buildConfig(global, jobs)
    if (config.jobs.length === 0) return
    setOutputLines(['Starting test...'])
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      setOutputLines((prev) => [...prev, `Error: ${(err as { error?: string }).error || res.statusText}`])
    }
  }

  const stop = async () => {
    setOutputLines((prev) => [...prev, 'Stopping...'])
    await fetch('/api/stop', { method: 'POST' })
  }

  const jobCount = jobs.length
  const runningLabel = useMemo(() => (state ? STATUS_LABEL[state.status] ?? state.status : 'Idle'), [state])

  const collapseAllExcept = (id: string) => {
    setJobs((prev) => prev.map((j) => ({ ...j, _collapsed: j._id !== id })))
  }

  const toggleCollapse = (id: string) => {
    setJobs((prev) => prev.map((j) => (j._id === id ? { ...j, _collapsed: !j._collapsed } : j)))
  }

  const addJobAfter = (afterId?: string, template?: Partial<JobConfig>) => {
    setJobs((prev) => {
      const draft = newJobDraft(template)
      const collapsedPrev = prev.map((j) => ({ ...j, _collapsed: true }))
      if (!afterId) return [...collapsedPrev, draft]
      const idx = prev.findIndex((j) => j._id === afterId)
      if (idx < 0) return [...collapsedPrev, draft]
      return [...collapsedPrev.slice(0, idx + 1), draft, ...collapsedPrev.slice(idx + 1)]
    })
  }

  const duplicateJob = (id: string) => {
    const src = jobs.find((j) => j._id === id)
    if (!src) return
    addJobAfter(id, src)
  }

  const removeJob = (id: string) => {
    setJobs((prev) => {
      const next = prev.filter((j) => j._id !== id)
      if (next.length === 0) return [newJobDraft({ name: 'job1' })]
      return next
    })
  }

  const moveJob = (id: string, dir: -1 | 1) => {
    setJobs((prev) => {
      const idx = prev.findIndex((j) => j._id === id)
      const to = idx + dir
      if (idx < 0 || to < 0 || to >= prev.length) return prev
      const copy = [...prev]
      const [item] = copy.splice(idx, 1)
      copy.splice(to, 0, item)
      return copy
    })
  }

  const updateJob = (id: string, patch: Partial<JobDraft>) => {
    setJobs((prev) => prev.map((j) => (j._id === id ? { ...j, ...patch } : j)))
  }

  const toggleStonewall = (id: string) => {
    setJobs((prev) => prev.map((j) => (j._id === id ? { ...j, _stonewallAfter: !j._stonewallAfter } : j)))
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
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-7xl space-y-5 p-6">
      <header className="flex items-center justify-between border-b border-border pb-4">
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold text-foreground">FIO WebUI</h1>
          <p className="text-xs text-muted-foreground">
            {jobCount} job{jobCount > 1 ? 's' : ''} · {jobs.some((j) => j._stonewallAfter) ? 'stonewall groups' : 'parallel execution'}
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
                </div>
              </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Global Settings</h3>
                <span className="text-xs text-muted-foreground">fio CLI + job defaults</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label className="text-xs">IO Engine</Label>
              <Select value={global.ioengine} onValueChange={(v) => setGlobal((g) => ({ ...g, ioengine: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.io_engines.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={global.direct} onCheckedChange={(v) => setGlobal((g) => ({ ...g, direct: v }))} />
              <Label className="text-xs">Direct I/O</Label>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Runtime (sec)</Label>
              <Input
                type="number"
                min={1}
                className="h-9"
                value={global.runtime}
                onChange={(e) => setGlobal((g) => ({ ...g, runtime: Number(e.target.value) || 60 }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Log sampling (ms)</Label>
              <Input
                type="number"
                min={100}
                className="h-9"
                value={global.log_avg_msec}
                onChange={(e) => setGlobal((g) => ({ ...g, log_avg_msec: Number(e.target.value) || 500 }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Output format</Label>
              <Select
                value={global.output_format}
                onValueChange={(v) => setGlobal((g) => ({ ...g, output_format: v }))}
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
                value={global.status_interval}
                onChange={(e) => setGlobal((g) => ({ ...g, status_interval: Number(e.target.value) || 0 }))}
              />
            </div>
          </div>
            </div>

            <div className="border-t border-border pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-medium text-foreground">Jobs</h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => addJobAfter(undefined, { name: `job${jobs.length + 1}` })}
                  >
                    Add Job
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => collapseAllExcept(jobs[0]?._id)}
                    disabled={jobs.length === 0}
                  >
                    Collapse Others
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {jobs.map((j, idx) => (
                  <div key={j._id}>
                    {/* Stonewall divider - show before job if previous job has stonewallAfter */}
                    {idx > 0 && jobs[idx - 1]._stonewallAfter && (
                      <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-dashed border-muted-foreground/40"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-background px-2 text-xs font-medium text-muted-foreground">Stonewall — Sequential Execution</span>
                        </div>
                      </div>
                    )}
                    <div className="rounded border border-border bg-card">
                      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
                          onClick={() => toggleCollapse(j._id)}
                          title={j._collapsed ? 'Expand' : 'Collapse'}
                        >
                          <span className="w-5 text-xs font-medium text-muted-foreground">{idx + 1}</span>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">
                              {j.name?.trim() || `job${idx + 1}`}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {j.rw} · {j.bs} · depth {j.iodepth} · {j.numjobs}× · {j.filename}
                            </div>
                          </div>
                        </button>

                        <div className="flex items-center gap-0.5">
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveJob(j._id, -1)} disabled={idx === 0}>
                            ↑
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveJob(j._id, 1)} disabled={idx === jobs.length - 1}>
                            ↓
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => duplicateJob(j._id)}>
                            Copy
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => addJobAfter(j._id, { name: `job${jobs.length + 1}` })}>
                            + After
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => removeJob(j._id)} disabled={jobs.length === 1}>
                            Remove
                          </Button>
                        </div>
                      </div>

                      {!j._collapsed && (
                        <div className="border-t border-border px-3 py-3">
                          <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
                            <Label className="text-xs font-medium">Job Parameters</Label>
                            <div className="flex items-center gap-2">
                              <Switch checked={j._stonewallAfter || false} onCheckedChange={() => toggleStonewall(j._id)} />
                              <Label className="text-xs">Stonewall after this job</Label>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Job name</Label>
                              <Input
                                className="h-9"
                                value={j.name}
                                onChange={(e) => updateJob(j._id, { name: e.target.value })}
                                onFocus={() => collapseAllExcept(j._id)}
                              />
                            </div>

                            <div className="space-y-1.5 sm:col-span-2">
                              <Label className="text-xs">Filename / Device</Label>
                              <Input
                                className="h-9"
                                value={j.filename}
                                onChange={(e) => updateJob(j._id, { filename: e.target.value })}
                                list="devices-list"
                                placeholder="/dev/nvme0n1 or /path/to/file"
                                onFocus={() => collapseAllExcept(j._id)}
                              />
                              <datalist id="devices-list">
                                {options.devices.map((d) => <option key={d} value={d} />)}
                              </datalist>
                            </div>

                            <div className="space-y-1.5">
                              <Label className="text-xs">IO Engine (override)</Label>
                              <Select 
                                value={j.ioengine ?? '__global__'} 
                                onValueChange={(v) => updateJob(j._id, { ioengine: v === '__global__' ? undefined : v })}
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder={`Use global (${global.ioengine})`} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__global__">Use global ({global.ioengine})</SelectItem>
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
                                onChange={(e) => updateJob(j._id, { runtime: e.target.value === '' ? undefined : Number(e.target.value) || undefined })}
                                placeholder={`Global: ${global.runtime}s`}
                              />
                            </div>

                            <div className="space-y-1.5">
                              <Label className="text-xs">RW</Label>
                            <Select value={j.rw} onValueChange={(v) => updateJob(j._id, { rw: v })}>
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
                            <Input className="h-9" value={j.bs} onChange={(e) => updateJob(j._id, { bs: e.target.value })} placeholder="4k" />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs">Size</Label>
                            <Input className="h-9" value={j.size} onChange={(e) => updateJob(j._id, { size: e.target.value })} placeholder="1G" />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs">Num jobs</Label>
                            <Input
                              className="h-9"
                              type="number"
                              min={1}
                              value={j.numjobs}
                              onChange={(e) => updateJob(j._id, { numjobs: Number(e.target.value) || 1 })}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs">IO depth</Label>
                            <Input
                              className="h-9"
                              type="number"
                              min={1}
                              value={j.iodepth}
                              onChange={(e) => updateJob(j._id, { iodepth: Number(e.target.value) || 1 })}
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
                                onChange={(e) => updateJob(j._id, { rwmixread: Number(e.target.value) || 0 })}
                              />
                            </div>
                          )}

                            <div className="space-y-1.5">
                              <Label className="text-xs">Rate (optional)</Label>
                              <Input
                                className="h-9"
                                value={j.rate ?? ''}
                                onChange={(e) => updateJob(j._id, { rate: e.target.value })}
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
          </CardContent>
        </Card>
      </div>

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
                <h2 className="text-base font-medium text-foreground">Output Log</h2>
                <Button variant="ghost" size="sm" onClick={() => setLogPanelOpen(false)}>
                  ×
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                <div className="output-terminal">
                  {outputLines.length === 0 && <span className="text-muted-foreground">Output will appear here.</span>}
                  {outputLines.map((line, i) => (
                    <div key={i} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
                  ))}
                  <div ref={outputEndRef} />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
