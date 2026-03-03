import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PRESETS, type PresetWorkload } from '../data/presets'
import { loadUserPresets, removeUserPreset, updateUserPreset } from '../lib/userPresets'
import {
  Brain,
  Box,
  ClipboardList,
  Cpu,
  Database,
  FileText,
  Globe,
  HardDrive,
  Layers,
  Shuffle,
} from 'lucide-react'

const CATEGORY_LABEL: Record<PresetWorkload['category'], string> = {
  random: '随机 I/O',
  sequential: '顺序 I/O',
  mixed: '混合读写',
  comprehensive: '综合测试',
  database: '数据库',
  kv: 'KV / 缓存',
  logging: '日志 / 追加写',
  docker: '容器 / 镜像',
  ci: 'CI / 构建系统',
  ai: 'AI / ML',
  web: 'Web 应用',
  user: '我的预设',
}

const CATEGORY_ICON: Record<PresetWorkload['category'], React.ReactNode> = {
  random: <Shuffle className="h-4 w-4" />,
  sequential: <HardDrive className="h-4 w-4" />,
  mixed: <Layers className="h-4 w-4" />,
  comprehensive: <ClipboardList className="h-4 w-4" />,
  database: <Database className="h-4 w-4" />,
  kv: <Box className="h-4 w-4" />,
  logging: <FileText className="h-4 w-4" />,
  docker: <Cpu className="h-4 w-4" />,
  ci: <ClipboardList className="h-4 w-4" />,
  ai: <Brain className="h-4 w-4" />,
  web: <Globe className="h-4 w-4" />,
  user: <ClipboardList className="h-4 w-4" />,
}

export function PresetsPage() {
  const [userPresets, setUserPresets] = useState<PresetWorkload[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    setUserPresets(loadUserPresets())
  }, [])

  const allPresets: PresetWorkload[] = [...PRESETS, ...userPresets]

  const applyPreset = (preset: PresetWorkload) => {
    navigate('/', { state: { preset }, replace: false })
  }

  const handleDeletePreset = (id: string) => {
    const next = removeUserPreset(id)
    setUserPresets(next)
  }

  const handleRenamePreset = (preset: PresetWorkload) => {
    const nameDefault = preset.name
    // eslint-disable-next-line no-alert
    const nextName = window.prompt('新的预设名称', nameDefault)
    if (!nextName || nextName.trim() === preset.name) return
    const next = updateUserPreset(preset.id, { name: nextName.trim() })
    setUserPresets(next)
  }

  const grouped = allPresets.reduce<Record<PresetWorkload['category'], PresetWorkload[]>>(
    (acc: Record<PresetWorkload['category'], PresetWorkload[]>, p: PresetWorkload) => {
      if (!acc[p.category]) acc[p.category] = []
      acc[p.category].push(p)
      return acc
    },
    {} as Record<PresetWorkload['category'], PresetWorkload[]>
  )

  const order: PresetWorkload['category'][] = [
    'random',
    'sequential',
    'mixed',
    'comprehensive',
    'database',
    'kv',
    'logging',
    'docker',
    'ci',
    'ai',
    'web',
    'user',
  ]

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
                    <PresetCard
                      key={preset.id}
                      preset={preset}
                      onApply={() => applyPreset(preset)}
                      onDelete={
                        preset.id.startsWith('user-') ? () => handleDeletePreset(preset.id) : undefined
                      }
                      onRename={
                        preset.id.startsWith('user-') ? () => handleRenamePreset(preset) : undefined
                      }
                    />
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

function PresetCard({
  preset,
  onApply,
  onDelete,
  onRename,
}: {
  preset: PresetWorkload
  onApply: () => void
  onDelete?: () => void
  onRename?: () => void
}) {
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
      {(onDelete || onRename) && (
        <div className="mt-2 flex justify-end gap-2">
          {onRename && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onRename}
            >
              重命名
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive"
              onClick={onDelete}
            >
              删除
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
