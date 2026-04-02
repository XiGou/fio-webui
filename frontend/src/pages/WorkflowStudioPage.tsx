import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { StageCard } from '@/components/builder/StageCard'
import { InspectorPanel } from '@/components/builder/InspectorPanel'
import { useBuilderStore } from '@/lib/useBuilderStore'
import type { RunState } from '@/types/api'

export function WorkflowStudioPage() {
  const navigate = useNavigate()
  const {
    experiment,
    setExperiment,
    selectedStage,
    selectedJob,
    selectedStageId,
    selectedJobId,
    setSelectedStageId,
    setSelectedJobId,
    addStage,
    updateStage,
    removeStage,
    addJob,
    updateJob,
    removeJob,
    compileResult,
  } = useBuilderStore()

  const [runError, setRunError] = useState('')
  const [running, setRunning] = useState(false)
  const [activeRun, setActiveRun] = useState<RunState | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status')
        if (!res.ok) return
        const state = (await res.json()) as RunState
        if (!cancelled) {
          setActiveRun(state.status === 'running' ? state : null)
        }
      } catch {
        if (!cancelled) {
          setActiveRun(null)
        }
      }
    }

    fetchStatus()
    const timer = window.setInterval(fetchStatus, 3000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const canRun = useMemo(
    () => compileResult.errors.length === 0 && compileResult.taskList.tasks.length > 0 && activeRun?.status !== 'running',
    [activeRun?.status, compileResult]
  )

  const openActiveRun = (runId?: string) => {
    if (!runId) return
    navigate(`/monitor?runId=${runId}`)
  }

  const syncActiveRun = async () => {
    try {
      const res = await fetch('/api/status')
      if (!res.ok) return null
      const state = (await res.json()) as RunState
      const next = state.status === 'running' ? state : null
      setActiveRun(next)
      return next
    } catch {
      return null
    }
  }

  const run = async () => {
    setRunError('')
    if (!canRun) return
    setRunning(true)
    try {
      const currentRun = await syncActiveRun()
      if (currentRun?.id) {
        setRunError('已有运行中的任务，正在跳转到监控页。')
        openActiveRun(currentRun.id)
        return
      }

      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: compileResult.taskList.tasks }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '启动失败' }))
        if (res.status === 409) {
          const currentRunAfterConflict = await syncActiveRun()
          if (currentRunAfterConflict?.id) {
            setRunError('已有运行中的任务，正在跳转到监控页。')
            openActiveRun(currentRunAfterConflict.id)
            return
          }
        }
        setRunError(err.error || '启动失败')
        return
      }
      const state = (await res.json()) as RunState
      if (state.id) navigate(`/monitor?runId=${state.id}`)
    } catch {
      setRunError('网络错误，启动失败')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle>AI Harness Builder（Stage / Job）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={experiment.name}
            onChange={(e) => setExperiment((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Experiment Name"
          />
          <p className="text-xs text-muted-foreground">LLM 产出可直接映射到 Experiment JSON，并编译为 fio task list。</p>
          <div className="flex gap-2">
            <Button onClick={addStage} variant="outline">+ Stage</Button>
            <Button onClick={run} disabled={!canRun || running}>
              {running ? '运行中…' : activeRun?.status === 'running' ? '已有任务运行中' : '编译并执行'}
            </Button>
          </div>
          {runError ? <p className="text-sm text-red-600">{runError}</p> : null}
          {activeRun?.status === 'running' ? (
            <p className="text-sm text-amber-700">
              当前已有运行中的任务。
              <button className="ml-1 underline underline-offset-4" onClick={() => openActiveRun(activeRun.id)} type="button">
                查看监控
              </button>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {experiment.stages.map((stage) => (
            <StageCard
              key={stage.id}
              stage={stage}
              experimentGlobal={experiment.global}
              selectedStageId={selectedStageId}
              selectedJobId={selectedJobId}
              onSelectStage={() => {
                setSelectedStageId(stage.id)
                setSelectedJobId(null)
              }}
              onSelectJob={(jobId) => {
                setSelectedStageId(stage.id)
                setSelectedJobId(jobId)
              }}
              onAddJob={() => addJob(stage.id)}
              onDeleteJob={(jobId) => removeJob(stage.id, jobId)}
              onDeleteStage={() => removeStage(stage.id)}
            />
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle>Inspector</CardTitle></CardHeader>
          <CardContent>
            <InspectorPanel
              experimentGlobal={experiment.global}
              stage={selectedStage}
              job={selectedJob}
              onUpdateStage={(patch) => selectedStage && updateStage(selectedStage.id, patch)}
              onUpdateJob={(patch) => selectedStage && selectedJob && updateJob(selectedStage.id, selectedJob.id, patch)}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Compile Output</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {compileResult.errors.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-red-600">
              {compileResult.errors.map((err) => <li key={err}>{err}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-green-700">编译通过，可执行。</p>
          )}
          <pre className="max-h-[320px] overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify(compileResult.taskList, null, 2)}</pre>
        </CardContent>
      </Card>
    </div>
  )
}
