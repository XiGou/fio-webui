import { Button } from '@/components/ui/button'
import { JobBrick } from '@/components/builder/JobBrick'
import type { ExperimentStage } from '@/types/experiment'

interface StageCardProps {
  stage: ExperimentStage
  selectedStageId: string | null
  selectedJobId: string | null
  onSelectStage: () => void
  onSelectJob: (jobId: string) => void
  onAddJob: () => void
  onDeleteJob: (jobId: string) => void
  onDeleteStage: () => void
}

export function StageCard({ stage, selectedStageId, selectedJobId, onSelectStage, onSelectJob, onAddJob, onDeleteJob, onDeleteStage }: StageCardProps) {
  const selected = selectedStageId === stage.id
  return (
    <section className={`rounded-lg border p-3 ${selected ? 'border-primary' : 'border-border'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={onSelectStage} className="text-left">
          <h3 className="text-sm font-semibold">{stage.name}</h3>
          <p className="text-xs text-muted-foreground">模式：{stage.mode}</p>
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
            selected={selectedJobId === job.id}
            onSelect={() => onSelectJob(job.id)}
            onDelete={() => onDeleteJob(job.id)}
          />
        ))}
      </div>
    </section>
  )
}
