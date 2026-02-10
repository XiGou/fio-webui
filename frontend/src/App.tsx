import { useEffect, useRef, useState } from 'react'
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

function buildConfig(
  global: { ioengine: string; direct: boolean; runtime: number; log_avg_msec: number },
  job: JobConfig,
  extraJobs: JobConfig[]
): FioConfig {
  const jobs = [{ ...job }, ...extraJobs]
  return {
    global: {
      ioengine: global.ioengine,
      direct: global.direct,
      runtime: global.runtime,
      time_based: true,
      group_reporting: true,
      log_avg_msec: global.log_avg_msec,
      output_format: 'json',
      status_interval: 1,
    },
    jobs: jobs.map((j) => ({
      name: j.name || 'job1',
      filename: j.filename,
      rw: j.rw,
      bs: j.bs,
      size: j.size,
      numjobs: j.numjobs,
      iodepth: j.iodepth,
      rwmixread: j.rwmixread,
      rate: j.rate || '',
    })),
  }
}

export default function App() {
  const [options, setOptions] = useState<OptionsResponse | null>(null)
  const [global, setGlobal] = useState({
    ioengine: 'libaio',
    direct: true,
    runtime: 60,
    log_avg_msec: 500,
  })
  const [job, setJob] = useState<JobConfig>({
    name: 'job1',
    filename: '/tmp/fio-test',
    rw: 'randread',
    bs: '4k',
    size: '1G',
    numjobs: 1,
    iodepth: 32,
    rwmixread: 70,
    rate: '',
  })
  const [extraJobs, setExtraJobs] = useState<JobConfig[]>([])
  const [state, setState] = useState<RunState | null>(null)
  const [outputLines, setOutputLines] = useState<string[]>([])
  const [backendOffline, setBackendOffline] = useState(false)
  const [wsReconnecting, setWsReconnecting] = useState(false)
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
          }))
        }
        if (def?.job) {
          setJob((j) => ({
            name: def.job.name ?? j.name,
            filename: def.job.filename ?? j.filename,
            rw: def.job.rw ?? j.rw,
            bs: def.job.bs ?? j.bs,
            size: def.job.size ?? j.size,
            numjobs: def.job.numjobs ?? j.numjobs,
            iodepth: def.job.iodepth ?? j.iodepth,
            rwmixread: def.job.rwmixread ?? j.rwmixread,
            rate: def.job.rate ?? j.rate,
          }))
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
    outputEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [outputLines])

  const run = state?.status === 'running'
  const start = async () => {
    const config = buildConfig(global, job, extraJobs)
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

  const addJob = () => {
    setExtraJobs((prev) => [...prev, { ...job }])
    setOutputLines((prev) => [...prev, `Added job: ${job.name || 'Unnamed'}`])
  }

  const removeJob = (i: number) => {
    setExtraJobs((prev) => prev.filter((_, idx) => idx !== i))
  }

  const showRwmix =
    job.rw === 'randrw' || job.rw === 'readwrite' || job.rw === 'rw' ||
    job.rw === 'trimwrite' || job.rw === 'randtrimwrite'

  if (!options) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4">
      <header className="flex items-center justify-between border-b pb-4">
        <h1 className="text-2xl font-semibold text-primary">FIO WebUI</h1>
        <div className="flex items-center gap-2">
          {wsReconnecting && (
            <span className="text-xs text-muted-foreground">正在重连…</span>
          )}
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              run ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400' :
              state?.status === 'finished' ? 'bg-green-500/20 text-green-700 dark:text-green-400' :
              state?.status === 'error' ? 'bg-destructive/20 text-destructive' :
              'bg-muted text-muted-foreground'
            }`}
          >
            {state ? STATUS_LABEL[state.status] ?? state.status : 'Idle'}
          </span>
        </div>
      </header>

      {backendOffline && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <strong>后端未连接。</strong> 请先启动服务：<code className="rounded bg-black/10 px-1.5 py-0.5">./fio-webui</code>（默认 :8080）。当前使用默认选项，配置可填但运行需后端。
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Test Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>IO Engine</Label>
              <Select value={global.ioengine} onValueChange={(v) => setGlobal((g) => ({ ...g, ioengine: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.io_engines.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-8">
              <Switch checked={global.direct} onCheckedChange={(v) => setGlobal((g) => ({ ...g, direct: v }))} />
              <Label>Direct IO</Label>
            </div>
            <div className="space-y-2">
              <Label>Runtime (sec)</Label>
              <Input
                type="number"
                min={1}
                value={global.runtime}
                onChange={(e) => setGlobal((g) => ({ ...g, runtime: Number(e.target.value) || 60 }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Log sampling (ms)</Label>
              <Input
                type="number"
                min={100}
                value={global.log_avg_msec}
                onChange={(e) => setGlobal((g) => ({ ...g, log_avg_msec: Number(e.target.value) || 500 }))}
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Job</h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label>Job name</Label>
                <Input value={job.name} onChange={(e) => setJob((j) => ({ ...j, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Filename / Device</Label>
                <Input
                  value={job.filename}
                  onChange={(e) => setJob((j) => ({ ...j, filename: e.target.value }))}
                  list="devices-list"
                  placeholder="/dev/sda or /path/to/file"
                />
                <datalist id="devices-list">
                  {options.devices.map((d) => <option key={d} value={d} />)}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label>Read/Write</Label>
                <Select value={job.rw} onValueChange={(v) => setJob((j) => ({ ...j, rw: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {options.rw_types.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Block size</Label>
                <Input value={job.bs} onChange={(e) => setJob((j) => ({ ...j, bs: e.target.value }))} placeholder="4k" />
              </div>
              <div className="space-y-2">
                <Label>Size</Label>
                <Input value={job.size} onChange={(e) => setJob((j) => ({ ...j, size: e.target.value }))} placeholder="1G" />
              </div>
              <div className="space-y-2">
                <Label>Num jobs</Label>
                <Input
                  type="number"
                  min={1}
                  value={job.numjobs}
                  onChange={(e) => setJob((j) => ({ ...j, numjobs: Number(e.target.value) || 1 }))}
                />
              </div>
              <div className="space-y-2">
                <Label>IO depth</Label>
                <Input
                  type="number"
                  min={1}
                  value={job.iodepth}
                  onChange={(e) => setJob((j) => ({ ...j, iodepth: Number(e.target.value) || 1 }))}
                />
              </div>
              {showRwmix && (
                <div className="space-y-2">
                  <Label>Read %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={job.rwmixread}
                    onChange={(e) => setJob((j) => ({ ...j, rwmixread: Number(e.target.value) || 0 }))}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label>Rate (optional)</Label>
                <Input value={job.rate ?? ''} onChange={(e) => setJob((j) => ({ ...j, rate: e.target.value }))} placeholder="1m, 500k" />
              </div>
            </div>
            <Button type="button" variant="secondary" className="mt-3" onClick={addJob}>
              Add job
            </Button>
          </div>

          {extraJobs.length > 0 && (
            <div className="space-y-2">
              <Label>Extra jobs</Label>
              <ul className="space-y-2">
                {extraJobs.map((j, i) => (
                  <li key={i} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span>{j.name || `Job ${i + 2}`} — {j.filename} {j.rw} {j.bs}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeJob(i)}>
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={start} disabled={run}>
              Start test
            </Button>
            <Button variant="destructive" onClick={stop} disabled={!run}>
              Stop
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Output log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="output-terminal">
            {outputLines.length === 0 && <span className="text-muted-foreground">Output will appear here.</span>}
            {outputLines.map((line, i) => (
              <div key={i} dangerouslySetInnerHTML={{ __html: ansiToHtml(line) }} />
            ))}
            <div ref={outputEndRef} />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
