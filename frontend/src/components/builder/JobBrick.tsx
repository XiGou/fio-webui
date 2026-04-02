import { Button } from '@/components/ui/button'
import type { ExperimentJob } from '@/types/experiment'

interface JobBrickProps {
  job: ExperimentJob
  selected?: boolean
  onSelect: () => void
  onDelete: () => void
}

export function JobBrick({ job, selected, onSelect, onDelete }: JobBrickProps) {
  return (
    <div className={`rounded border p-2 text-xs ${selected ? 'border-primary bg-primary/5' : 'border-border'}`}>
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <p className="font-medium">{job.name}</p>
        <p className="text-muted-foreground">{job.rw} · {job.bs} · qd{job.iodepth}</p>
      </button>
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onDelete}>删除</Button>
      </div>
    </div>
  )
}
