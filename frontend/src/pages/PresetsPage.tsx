import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PRESETS, type PresetWorkload } from '../data/presets'
import { ClipboardList, HardDrive, Shuffle, Layers } from 'lucide-react'

const CATEGORY_LABEL: Record<PresetWorkload['category'], string> = {
  random: '随机 I/O',
  sequential: '顺序 I/O',
  mixed: '混合读写',
  comprehensive: '综合测试',
}

const CATEGORY_ICON: Record<PresetWorkload['category'], React.ReactNode> = {
  random: <Shuffle className="h-4 w-4" />,
  sequential: <HardDrive className="h-4 w-4" />,
  mixed: <Layers className="h-4 w-4" />,
  comprehensive: <ClipboardList className="h-4 w-4" />,
}

export function PresetsPage() {
  const navigate = useNavigate()

  const applyPreset = (preset: PresetWorkload) => {
    navigate('/', { state: { preset }, replace: false })
  }

  const grouped = PRESETS.reduce<Record<PresetWorkload['category'], PresetWorkload[]>>(
    (acc, p) => {
      if (!acc[p.category]) acc[p.category] = []
      acc[p.category].push(p)
      return acc
    },
    {} as Record<PresetWorkload['category'], PresetWorkload[]>
  )

  const order: PresetWorkload['category'][] = ['random', 'sequential', 'mixed', 'comprehensive']

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">预设负载</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          选择常见存储测试场景，点击后将参数填入创建任务页面，可修改后执行
        </p>
      </div>

      <div className="space-y-6">
        {order.map((cat) => {
          const items = grouped[cat]
          if (!items?.length) return null

          return (
            <Card key={cat}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base font-medium">
                  {CATEGORY_ICON[cat]}
                  {CATEGORY_LABEL[cat]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((preset: PresetWorkload) => (
                    <PresetCard key={preset.id} preset={preset} onApply={() => applyPreset(preset)} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function PresetCard({ preset, onApply }: { preset: PresetWorkload; onApply: () => void }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-muted/30">
      <div className="flex-1">
        <h3 className="font-medium text-foreground">{preset.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground font-mono">{preset.configSummary}</p>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{preset.description}</p>
        {preset.task.jobs.length > 1 && (
          <p className="mt-2 text-xs text-muted-foreground">
            包含 {preset.task.jobs.length} 个 Job{preset.stonewallBetweenJobs ? '（依次执行）' : ''}
          </p>
        )}
      </div>
      <Button className="mt-4 w-full" variant="outline" size="sm" onClick={onApply}>
        使用此预设
      </Button>
    </div>
  )
}
