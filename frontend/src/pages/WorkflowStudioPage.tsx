import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, Check, ChevronRight, CloudUpload, FilePlus2, FolderOpen, Loader2, Play, Save, ShieldAlert, X } from 'lucide-react'
import { GlobalInspector } from '@/components/builder/GlobalInspector'
import { InspectorPanel } from '@/components/builder/InspectorPanel'
import { ModulePalette } from '@/components/builder/ModulePalette'
import { PipelineCanvas } from '@/components/builder/PipelineCanvas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { defaultExperiment, experimentFromTaskList } from '@/lib/experimentCompiler'
import { useBuilderStore } from '@/lib/useBuilderStore'
import { taskListToWorkflow } from '@/lib/workflowMapper'
import type { FioTaskList, RunState, TaskValidationResponse } from '@/types/api'

type ValidationState = { status: 'idle' | 'checking' | 'valid' | 'invalid'; messages: string[] }
type RestoreState = { restoreRunConfig?: FioTaskList; restoreRunId?: string }
type WorkflowSummary = { id: string; name: string; description: string; updated_at: string; current_version: number }
type WorkflowTemplate = WorkflowSummary & { versions: Array<{ version: number; task_list: FioTaskList }> }
const WORKFLOW_ID_KEY = 'fio-webui:workflow-id:v1'

function isDestructive(rw: string): boolean {
  return rw.includes('write') || rw.includes('rw') || rw.includes('trim')
}

export function WorkflowStudioPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    experiment, setExperiment, replaceExperiment,
    selectedStage, selectedJob, selectedStageId, selectedJobId,
    setSelectedStageId, setSelectedJobId, addStage, updateStage, removeStage,
    addJob, updateJob, removeJob, moveStage, compileResult,
  } = useBuilderStore()
  const [inspectorTab, setInspectorTab] = useState<'node' | 'global'>('node')
  const [validation, setValidation] = useState<ValidationState>({ status: 'idle', messages: [] })
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState('')
  const [workflowId, setWorkflowId] = useState(() => localStorage.getItem(WORKFLOW_ID_KEY) ?? '')
  const [workflowLibraryOpen, setWorkflowLibraryOpen] = useState(false)
  const [workflowLibrary, setWorkflowLibrary] = useState<WorkflowSummary[]>([])
  const [workflowLibraryLoading, setWorkflowLibraryLoading] = useState(false)
  const [runReviewOpen, setRunReviewOpen] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [runError, setRunError] = useState('')
  const runDialogRef = useRef<HTMLElement>(null)
  const runTriggerRef = useRef<HTMLButtonElement>(null)
  const runCancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (workflowId) localStorage.setItem(WORKFLOW_ID_KEY, workflowId)
    else localStorage.removeItem(WORKFLOW_ID_KEY)
  }, [workflowId])

  useEffect(() => {
    const state = location.state as RestoreState | null
    if (!state?.restoreRunConfig?.tasks?.length) return
    replaceExperiment(experimentFromTaskList(state.restoreRunConfig, state.restoreRunId))
    setWorkflowId('')
    navigate('/', { replace: true })
  }, [location.state, navigate, replaceExperiment])

  useEffect(() => {
    setValidation({ status: 'idle', messages: [] })
    setSavedAt('')
  }, [experiment])

  const closeRunReview = useCallback(() => setRunReviewOpen(false), [])

  useEffect(() => {
    if (!runReviewOpen) return
    const dialog = runDialogRef.current
    const previousFocus = document.activeElement as HTMLElement | null
    runCancelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRunReview()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus()
    }
  }, [closeRunReview, runReviewOpen])

  const targets = useMemo(() => Array.from(new Set(compileResult.taskList.tasks.flatMap((task) => task.jobs.map((job) => job.filename)))), [compileResult.taskList.tasks])
  const destructiveJobs = useMemo(() => compileResult.taskList.tasks.flatMap((task) => task.jobs).filter((job) => isDestructive(job.rw)), [compileResult.taskList.tasks])
  const jobCount = useMemo(() => experiment.stages.reduce((sum, stage) => sum + stage.jobs.length, 0), [experiment.stages])

  const validate = useCallback(async (): Promise<boolean> => {
    if (compileResult.errors.length) {
      setValidation({ status: 'invalid', messages: compileResult.errors })
      return false
    }
    setValidation({ status: 'checking', messages: [] })
    try {
      const responses = await Promise.all(compileResult.taskList.tasks.map(async (task) => {
        const response = await fetch('/api/validate', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ global: task.global, jobs: task.jobs }),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as TaskValidationResponse
      }))
      const messages = responses.flatMap((result) => [
        ...(result.errors ?? []).map((item) => `${item.field}: ${item.message}`),
        ...(result.warnings ?? []).map((item) => `${item.field}: ${item.message}`),
      ])
      const valid = responses.every((result) => result.valid)
      setValidation({ status: valid ? 'valid' : 'invalid', messages })
      return valid
    } catch (error) {
      setValidation({ status: 'invalid', messages: [`无法完成后端校验：${error instanceof Error ? error.message : '网络错误'}`] })
      return false
    }
  }, [compileResult])

  const prepareRun = async () => {
    setRunError('')
    if (await validate()) setRunReviewOpen(true)
  }

  const openWorkflowLibrary = async () => {
    setWorkflowLibraryOpen(true)
    setWorkflowLibraryLoading(true)
    try {
      const response = await fetch('/api/workflows')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setWorkflowLibrary(await response.json() as WorkflowSummary[])
    } catch (error) {
      setRunError(`读取工作流失败：${error instanceof Error ? error.message : '网络错误'}`)
    } finally {
      setWorkflowLibraryLoading(false)
    }
  }

  const loadWorkflow = async (id: string) => {
    setWorkflowLibraryLoading(true)
    try {
      const response = await fetch(`/api/workflows/${id}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const template = await response.json() as WorkflowTemplate
      const latest = template.versions.find((version) => version.version === template.current_version) ?? template.versions.at(-1)
      if (!latest?.task_list.tasks.length) throw new Error('工作流没有可恢复的任务版本')
      const restored = experimentFromTaskList(latest.task_list)
      replaceExperiment({ ...restored, name: template.name, description: template.description })
      setWorkflowId(template.id)
      setWorkflowLibraryOpen(false)
    } catch (error) {
      setRunError(`打开工作流失败：${error instanceof Error ? error.message : '网络错误'}`)
    } finally {
      setWorkflowLibraryLoading(false)
    }
  }

  const createDraft = () => {
    replaceExperiment(defaultExperiment())
    setWorkflowId('')
    setSavedAt('')
    setWorkflowLibraryOpen(false)
  }

  const saveWorkflow = async () => {
    if (compileResult.errors.length) return
    setSaving(true)
    try {
      const body = workflowId
        ? { published_by: 'studio-user', task_list: compileResult.taskList, workflow: taskListToWorkflow(compileResult.taskList) }
        : { name: experiment.name, description: experiment.description ?? '', tags: ['pipeline'], created_by: 'studio-user', task_list: compileResult.taskList, workflow: taskListToWorkflow(compileResult.taskList) }
      const response = await fetch(workflowId ? `/api/workflows/${workflowId}/versions` : '/api/workflows', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!response.ok) throw new Error(await response.text())
      const saved = await response.json() as { id?: string }
      if (saved.id) setWorkflowId(saved.id)
      setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    } catch (error) {
      setRunError(`保存失败：${error instanceof Error ? error.message : '网络错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const startRun = async () => {
    setRunBusy(true)
    setRunError('')
    try {
      const response = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: compileResult.taskList.tasks, workflow_id: workflowId, compiled_at: new Date().toISOString() }),
      })
      const state = await response.json().catch(() => ({})) as RunState & { error?: string }
      if (!response.ok) throw new Error(state.error || '启动失败')
      setRunReviewOpen(false)
      navigate(`/monitor?runId=${state.id}`)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '启动失败')
    } finally {
      setRunBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-workbench">
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-2 lg:px-5">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="experiment-name" className="sr-only">测试名称</Label>
          <Input id="experiment-name" className="h-8 max-w-xl border-0 px-0 text-base font-semibold shadow-none focus-visible:ring-0" value={experiment.name} onChange={(event) => setExperiment((previous) => ({ ...previous, name: event.target.value }))} />
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{experiment.stages.length} 节点</span><span>·</span><span>{jobCount} Job</span><span>·</span>
            {savedAt ? <span className="text-emerald-700">已保存 {savedAt}</span> : <span>本地草稿</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {validation.status === 'valid' ? <Badge tone="success"><Check className="mr-1 h-3 w-3" />校验通过</Badge> : null}
          {validation.status === 'invalid' ? <Badge tone="danger"><AlertTriangle className="mr-1 h-3 w-3" />需要修正</Badge> : null}
          <Button variant="ghost" onClick={openWorkflowLibrary}><FolderOpen />打开</Button>
          <Button variant="outline" onClick={saveWorkflow} disabled={saving || compileResult.errors.length > 0}>{saving ? <Loader2 className="animate-spin" /> : <Save />}保存版本</Button>
          <Button ref={runTriggerRef} onClick={prepareRun} disabled={validation.status === 'checking' || jobCount === 0}>{validation.status === 'checking' ? <Loader2 className="animate-spin" /> : <Play />}校验并运行</Button>
        </div>
      </header>

      {(runError || validation.messages.length > 0) ? (
        <div className={cn('flex items-start gap-2 border-b px-4 py-2 text-xs', runError || validation.status === 'invalid' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{runError || validation.messages.join(' · ')}</span>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)_360px]">
        <ModulePalette
          canAddJob={Boolean(selectedStage)}
          insertAfterLabel={selectedStage ? `OP ${String(experiment.stages.findIndex((stage) => stage.id === selectedStage.id) + 1).padStart(2, '0')}` : undefined}
          onAddStage={() => addStage(selectedStageId)}
          onAddJob={(preset) => selectedStage && addJob(selectedStage.id, preset)}
        />
        <PipelineCanvas
          stages={experiment.stages}
          selectedStageId={selectedStageId}
          selectedJobId={selectedJobId}
          onSelectStage={(stageId) => { setSelectedStageId(stageId); setSelectedJobId(null); setInspectorTab('node') }}
          onSelectJob={(stageId, jobId) => { setSelectedStageId(stageId); setSelectedJobId(jobId); setInspectorTab('node') }}
          onAddStage={addStage}
          onAddJob={(stageId) => addJob(stageId)}
          onDeleteStage={removeStage}
          onDeleteJob={removeJob}
          onMoveStage={moveStage}
        />
        <aside className="flex min-h-0 flex-col border-l border-border bg-background">
          <div className="flex h-12 shrink-0 border-b border-border" role="tablist" aria-label="参数范围">
            <button className={cn('inspector-tab', inspectorTab === 'node' && 'is-active')} type="button" role="tab" aria-selected={inspectorTab === 'node'} onClick={() => setInspectorTab('node')}>当前节点</button>
            <button className={cn('inspector-tab', inspectorTab === 'global' && 'is-active')} type="button" role="tab" aria-selected={inspectorTab === 'global'} onClick={() => setInspectorTab('global')}>全局默认</button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4" role="tabpanel">
            {inspectorTab === 'global' ? (
              <GlobalInspector values={experiment.global} onChange={(global) => setExperiment((previous) => ({ ...previous, global }))} />
            ) : (
              <InspectorPanel
                experimentGlobal={experiment.global}
                stage={selectedStage}
                job={selectedJob}
                onUpdateStage={(patch) => selectedStage && updateStage(selectedStage.id, patch)}
                onUpdateJob={(patch) => selectedStage && selectedJob && updateJob(selectedStage.id, selectedJob.id, patch)}
              />
            )}
          </div>
        </aside>
      </div>

      {workflowLibraryOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setWorkflowLibraryOpen(false) }}>
          <section className="w-full max-w-2xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="workflow-library-title">
            <header className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 id="workflow-library-title" className="text-base font-semibold">工作流库</h2><p className="text-xs text-muted-foreground">打开已保存定义的最新版本。</p></div><Button size="icon" variant="ghost" aria-label="关闭" onClick={() => setWorkflowLibraryOpen(false)}><X /></Button></header>
            <div className="max-h-[60vh] overflow-y-auto p-3">
              {workflowLibraryLoading ? <div className="flex h-28 items-center justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div> : workflowLibrary.map((item) => (
                <button key={item.id} className="flex w-full items-center gap-3 border-b border-border px-3 py-3 text-left hover:bg-muted" type="button" onClick={() => loadWorkflow(item.id)}>
                  <span className="flex h-8 w-8 items-center justify-center bg-muted"><FolderOpen className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><small className="block truncate text-xs text-muted-foreground">{item.description || item.id}</small></span>
                  <span className="font-mono text-[10px] text-muted-foreground">v{item.current_version}</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
              {!workflowLibraryLoading && workflowLibrary.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">还没有已保存工作流。</p> : null}
            </div>
            <footer className="flex justify-between border-t border-border bg-muted/40 px-5 py-3"><Button variant="ghost" onClick={createDraft}><FilePlus2 />新建草稿</Button><Button variant="outline" onClick={() => setWorkflowLibraryOpen(false)}>关闭</Button></footer>
          </section>
        </div>
      ) : null}

      {runReviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRunReview() }}>
          <section ref={runDialogRef} className="w-full max-w-xl border border-border bg-background shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="run-review-title">
            <header className="flex items-start justify-between border-b border-border px-5 py-4">
              <div><Badge tone={destructiveJobs.length ? 'warning' : 'success'}>{destructiveJobs.length ? 'WRITE PATH' : 'READ ONLY'}</Badge><h2 id="run-review-title" className="mt-2 text-base font-semibold">执行前复核</h2><p className="text-xs text-muted-foreground">编译结果已通过校验，确认目标与影响范围。</p></div>
              <Button size="icon" variant="ghost" aria-label="关闭" onClick={closeRunReview}><X /></Button>
            </header>
            <div className="space-y-4 p-5">
              {destructiveJobs.length ? <div className="flex gap-3 border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><span><strong className="block">检测到 {destructiveJobs.length} 个写入工作负载</strong>目标文件或块设备上的既有数据可能被覆盖。</span></div> : null}
              <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">测试名称</dt><dd className="font-medium">{experiment.name}</dd>
                <dt className="text-muted-foreground">执行结构</dt><dd>{experiment.stages.length} 节点 / {jobCount} Job</dd>
                <dt className="text-muted-foreground">预计时长</dt><dd>至少 {String(experiment.global.runtime ?? 60)} 秒 / 节点</dd>
                <dt className="text-muted-foreground">指标来源</dt><dd className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-600" />fio stdout/status stream</dd>
                <dt className="text-muted-foreground">目标</dt><dd className="space-y-1 font-mono text-xs">{targets.map((target) => <div className="break-all" key={target}>{target}</div>)}</dd>
              </dl>
            </div>
            <footer className="flex items-center justify-between border-t border-border bg-muted/40 px-5 py-3">
              <span className="text-xs text-muted-foreground">运行启动后自动进入实时监控</span>
              <div className="flex gap-2"><Button ref={runCancelRef} variant="outline" onClick={closeRunReview}>取消</Button><Button className={destructiveJobs.length ? 'bg-amber-600 hover:bg-amber-700' : ''} onClick={startRun} disabled={runBusy}>{runBusy ? <Loader2 className="animate-spin" /> : <CloudUpload />}确认并启动<ChevronRight /></Button></div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
