import { ArrowLeft, ArrowRight, BarChart3, Check, CircleStop, Layers3, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ExperimentStage } from '@/types/experiment'

type PipelineCanvasProps = {
  stages: ExperimentStage[]
  selectedStageId: string | null
  selectedJobId: string | null
  onSelectStage: (stageId: string) => void
  onSelectJob: (stageId: string, jobId: string) => void
  onAddStage: () => void
  onAddJob: (stageId: string) => void
  onDeleteStage: (stageId: string) => void
  onDeleteJob: (stageId: string, jobId: string) => void
  onMoveStage: (stageId: string, direction: -1 | 1) => void
}

function JobModule({ stageId, job, selected, onSelect, onDelete }: {
  stageId: string
  job: ExperimentStage['jobs'][number]
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const rw = String(job.overrides.rw ?? 'read')
  const writes = rw.includes('write') || rw.includes('rw') || rw.includes('trim')
  return (
    <div className={cn('group relative border-l-2 bg-background px-3 py-2.5', selected ? 'border-l-primary bg-primary/[0.035]' : writes ? 'border-l-amber-400' : 'border-l-emerald-500')}>
      <button className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" type="button" onClick={onSelect}>
        <span className="flex items-center justify-between gap-3">
          <strong className="truncate text-xs font-semibold">{job.name}</strong>
          <span className="font-mono text-[10px] text-muted-foreground">{rw}</span>
        </span>
        <span className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span>bs={String(job.overrides.bs ?? '4k')}</span>
          <span>qd={String(job.overrides.iodepth ?? 1)}</span>
          <span>jobs={String(job.overrides.numjobs ?? 'inherit')}</span>
        </span>
      </button>
      <button
        className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center text-muted-foreground hover:text-destructive group-hover:flex focus:flex"
        type="button"
        title="删除 Job"
        aria-label={`删除 ${job.name}`}
        onClick={(event) => { event.stopPropagation(); onDelete() }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <span className="sr-only">所属节点 {stageId}</span>
    </div>
  )
}

export function PipelineCanvas({ stages, selectedStageId, selectedJobId, onSelectStage, onSelectJob, onAddStage, onAddJob, onDeleteStage, onDeleteJob, onMoveStage }: PipelineCanvasProps) {
  return (
    <section className="pipeline-canvas min-h-0 overflow-auto" aria-label="测试流水线画布">
      <div className="flex min-h-full min-w-max items-start px-8 py-12 lg:px-12">
        <div className="pipeline-terminal mt-24">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background"><Check className="h-4 w-4" /></span>
          <strong>入口</strong>
          <small>COMPILE</small>
        </div>

        {stages.map((stage, index) => (
          <div className="flex items-start" key={stage.id}>
            <div className="pipeline-connector mt-[7.25rem]" aria-hidden="true"><span /></div>
            <article className={cn('pipeline-stage w-[282px] shrink-0', selectedStageId === stage.id && 'is-selected')}>
              <header>
                <button className="min-w-0 flex-1 text-left" type="button" onClick={() => onSelectStage(stage.id)}>
                  <span className="text-[10px] font-semibold text-muted-foreground">OP {String(index + 1).padStart(2, '0')}</span>
                  <strong className="mt-0.5 block truncate text-sm">{stage.name}</strong>
                </button>
                <Badge tone="info">
                  <Layers3 className="mr-1 h-3 w-3" />
                  {stage.jobs.length > 1 ? `${stage.jobs.length} JOBS · 并行` : `${stage.jobs.length} JOB`}
                </Badge>
              </header>

              <div className="divide-y divide-border border-y border-border">
                {stage.jobs.map((job) => (
                  <JobModule
                    key={job.id}
                    stageId={stage.id}
                    job={job}
                    selected={selectedJobId === job.id}
                    onSelect={() => onSelectJob(stage.id, job.id)}
                    onDelete={() => onDeleteJob(stage.id, job.id)}
                  />
                ))}
                {stage.jobs.length === 0 ? <p className="px-3 py-5 text-center text-xs text-destructive">节点中没有 Job</p> : null}
              </div>

              <footer>
                <Button size="sm" variant="ghost" onClick={() => onAddJob(stage.id)}><Plus />Job</Button>
                <span className="ml-auto flex">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onMoveStage(stage.id, -1)} disabled={index === 0} title="前移节点"><ArrowLeft /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onMoveStage(stage.id, 1)} disabled={index === stages.length - 1} title="后移节点"><ArrowRight /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-destructive" onClick={() => onDeleteStage(stage.id)} title="删除节点"><Trash2 /></Button>
                </span>
              </footer>
            </article>
          </div>
        ))}

        <div className="flex items-start">
          <div className="pipeline-connector mt-[7.25rem]" aria-hidden="true"><span /></div>
          <button className="pipeline-add mt-[5.7rem]" type="button" onClick={onAddStage} title="追加节点" aria-label="追加节点"><Plus /></button>
          <div className="pipeline-connector mt-[7.25rem]" aria-hidden="true"><span /></div>
          <div className="pipeline-terminal mt-24">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white"><BarChart3 className="h-4 w-4" /></span>
            <strong>证据</strong>
            <small>REPORT</small>
          </div>
        </div>
      </div>
      <div className="pointer-events-none sticky bottom-3 ml-auto mr-3 hidden w-fit items-center gap-2 border border-border bg-background/95 px-2 py-1 text-[10px] text-muted-foreground shadow-sm sm:flex">
        <CircleStop className="h-3 w-3 text-amber-500" /> 节点内 Job 并行 · 节点间依次执行
      </div>
    </section>
  )
}
