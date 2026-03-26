import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ExperimentJob, ExperimentStage } from '@/types/experiment'

interface InspectorPanelProps {
  stage: ExperimentStage | null
  job: ExperimentJob | null
  onUpdateStage: (patch: Partial<ExperimentStage>) => void
  onUpdateJob: (patch: Partial<ExperimentJob>) => void
}

export function InspectorPanel({ stage, job, onUpdateStage, onUpdateJob }: InspectorPanelProps) {
  if (!stage) {
    return <p className="text-sm text-muted-foreground">选择一个 Stage 或 Job 开始编辑。</p>
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Stage 名称</Label>
        <Input value={stage.name} onChange={(e) => onUpdateStage({ name: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label>Stage 模式</Label>
        <Select value={stage.mode} onValueChange={(v) => onUpdateStage({ mode: v as ExperimentStage['mode'] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sequential">sequential</SelectItem>
            <SelectItem value="parallel">parallel</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {job ? (
        <div className="space-y-2 border-t border-border pt-3">
          <h4 className="text-sm font-medium">Job 参数</h4>
          <Label>名称</Label>
          <Input value={job.name} onChange={(e) => onUpdateJob({ name: e.target.value })} />
          <Label>文件</Label>
          <Input value={job.filename} onChange={(e) => onUpdateJob({ filename: e.target.value })} />
          <Label>RW</Label>
          <Input value={job.rw} onChange={(e) => onUpdateJob({ rw: e.target.value })} />
          <Label>BS</Label>
          <Input value={job.bs} onChange={(e) => onUpdateJob({ bs: e.target.value })} />
          <Label>iodepth</Label>
          <Input type="number" value={job.iodepth} onChange={(e) => onUpdateJob({ iodepth: Number(e.target.value || 1) })} />
        </div>
      ) : null}
    </div>
  )
}
