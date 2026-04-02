import { Button } from '@/components/ui/button'
import type { ExperimentJob, FioParameterMap } from '@/types/experiment'

interface JobBrickProps {
  job: ExperimentJob
  effectiveParams: FioParameterMap
  overrideCount: number
  selected?: boolean
  onSelect: () => void
  onDelete: () => void
}

export function JobBrick({ job, effectiveParams, overrideCount, selected, onSelect, onDelete }: JobBrickProps) {
  const summary = [
    typeof effectiveParams.rw === 'string' ? effectiveParams.rw : 'rw?',
    typeof effectiveParams.bs === 'string' ? effectiveParams.bs : 'bs?',
    `depth ${Number(effectiveParams.iodepth ?? 1)}`,
  ].join(' · ')

  return (
    <div className={`rounded-xl border p-3 text-xs transition-colors ${selected ? 'border-primary bg-primary/5' : 'border-border bg-background'}`}>
      <button type="button" className="w-full text-left space-y-1" onClick={onSelect}>
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{job.name}</p>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${overrideCount > 0 ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
            {overrideCount > 0 ? `${overrideCount} overrides` : 'inherit only'}
          </span>
        </div>
        <p className="text-muted-foreground">{summary}</p>
        <p className="truncate text-[11px] text-muted-foreground/90">{String(effectiveParams.filename ?? '/tmp/fio-test')}</p>
      </button>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onDelete}>删除</Button>
      </div>
    </div>
  )
}
