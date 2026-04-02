import { Button } from '@/components/ui/button'
import { JobBrick } from '@/components/builder/JobBrick'
import { resolveEffectiveJobParams, resolveStageSharedParams } from '@/lib/fioParameters'
import type { ExperimentStage, FioParameterMap } from '@/types/experiment'

interface StageCardProps {
  stage: ExperimentStage
  experimentGlobal: FioParameterMap
  selectedStageId: string | null
  selectedJobId: string | null
  onSelectStage: () => void
  onSelectJob: (jobId: string) => void
  onAddJob: () => void
  onDeleteJob: (jobId: string) => void
  onDeleteStage: () => void
}

export function StageCard({ stage, experimentGlobal, selectedStageId, selectedJobId, onSelectStage, onSelectJob, onAddJob, onDeleteJob, onDeleteStage }: StageCardProps) {
  const selected = selectedStageId === stage.id
  const resolvedShared = resolveStageSharedParams(experimentGlobal, stage.shared)
  const sharedCount = Object.keys(stage.shared).length

  return (
    <section className={`rounded-2xl border p-4 transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={onSelectStage} className="text-left">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{stage.name}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{stage.mode}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {stage.jobs.length} jobs · {sharedCount} shared params · {String(resolvedShared.ioengine ?? 'ioengine?')}
          </p>
        </button>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onAddJob}>+ Job</Button>
          <Button size="sm" variant="ghost" onClick={onDeleteStage}>删除</Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {stage.jobs.map((job) => (
          <JobBrick
            key={job.id}
            job={job}
            effectiveParams={resolveEffectiveJobParams(experimentGlobal, stage.shared, job.overrides)}
            overrideCount={Object.keys(job.overrides).length}
            selected={selectedJobId === job.id}
            onSelect={() => onSelectJob(job.id)}
            onDelete={() => onDeleteJob(job.id)}
          />
        ))}
      </div>

      {sharedCount > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {Object.entries(stage.shared).slice(0, 6).map(([key, value]) => (
            <span key={key} className="rounded-full border border-border bg-background px-2 py-1 text-muted-foreground">
              {key}={String(value)}
            </span>
          ))}
          {sharedCount > 6 ? <span className="rounded-full border border-dashed border-border px-2 py-1 text-muted-foreground">+{sharedCount - 6} more</span> : null}
        </div>
      ) : null}
    </section>
  )
}
