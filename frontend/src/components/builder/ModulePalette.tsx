import { Activity, Braces, Gauge, Layers3, Plus, ShieldAlert } from 'lucide-react'
import type { ExperimentJob } from '@/types/experiment'

type ModulePaletteProps = {
  canAddJob: boolean
  onAddStage: () => void
  onAddJob: (preset: Partial<ExperimentJob>) => void
}

const workloads: Array<{
  label: string
  detail: string
  icon: typeof Activity
  preset: Partial<ExperimentJob>
  risky?: boolean
}> = [
  { label: '4K 随机读', detail: 'randread · qd32', icon: Gauge, preset: { name: 'randread-4k', overrides: { rw: 'randread', bs: '4k', iodepth: 32 } } },
  { label: '1M 顺序读', detail: 'read · qd8', icon: Activity, preset: { name: 'read-1m', overrides: { rw: 'read', bs: '1m', iodepth: 8 } } },
  { label: '70/30 混合', detail: 'randrw · qd32', icon: Braces, preset: { name: 'randrw-70-30', overrides: { rw: 'randrw', bs: '8k', iodepth: 32, rwmixread: 70 } }, risky: true },
  { label: '4K 随机写', detail: 'randwrite · qd32', icon: ShieldAlert, preset: { name: 'randwrite-4k', overrides: { rw: 'randwrite', bs: '4k', iodepth: 32 } }, risky: true },
]

export function ModulePalette({ canAddJob, onAddStage, onAddJob }: ModulePaletteProps) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border px-4 py-3">
        <p className="text-xs font-semibold text-foreground">模块库</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">PIPELINE MODULES</p>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <section>
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase text-muted-foreground">执行结构</p>
          <div className="space-y-2">
            <button className="module-palette-item" type="button" onClick={onAddStage}>
              <span className="module-icon"><Layers3 /></span>
              <span><strong>执行节点</strong><small>节点内 Job 并行</small></span>
              <Plus />
            </button>
          </div>
        </section>

        <section>
          <p className="mb-2 px-1 text-[10px] font-semibold uppercase text-muted-foreground">工作负载</p>
          <div className="space-y-2">
            {workloads.map(({ label, detail, icon: Icon, preset, risky }) => (
              <button
                key={label}
                className="module-palette-item"
                type="button"
                disabled={!canAddJob}
                onClick={() => onAddJob(preset)}
                title={canAddJob ? `加入当前节点：${label}` : '请先选择一个节点'}
              >
                <span className="module-icon"><Icon /></span>
                <span><strong>{label}</strong><small>{detail}</small></span>
                {risky ? <span className="h-2 w-2 rounded-full bg-amber-500" aria-label="包含写入" /> : <Plus />}
              </button>
            ))}
          </div>
        </section>

        <div className="border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
          <p className="flex items-center gap-2"><Layers3 className="h-3.5 w-3.5" />参数按 全局 / 节点 / Job 继承</p>
        </div>
      </div>
    </aside>
  )
}
