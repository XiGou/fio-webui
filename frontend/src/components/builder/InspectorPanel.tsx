import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  canOverrideAtJobLevel,
  getParameterGroups,
  resolveEffectiveJobParams,
  resolveStageSharedParams,
  type FioParameterField,
} from '@/lib/fioParameters'
import type { FioOptionValue, OptionsResponse } from '@/types/api'
import type { ExperimentJob, ExperimentStage, FioParameterMap } from '@/types/experiment'

type CustomDraftType = 'text' | 'number' | 'boolean'

interface InspectorPanelProps {
  experimentGlobal: FioParameterMap
  options?: OptionsResponse | null
  stage: ExperimentStage | null
  job: ExperimentJob | null
  onUpdateStage: (patch: Partial<ExperimentStage>) => void
  onUpdateJob: (patch: Partial<ExperimentJob>) => void
}

function formatInherited(value: FioOptionValue | undefined): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && value.trim()) return value
  return '未设置'
}

function emptyValueForField(field: FioParameterField, inherited: FioOptionValue | undefined): FioOptionValue {
  if (inherited !== undefined) return inherited
  if (field.type === 'boolean') return false
  if (field.type === 'number') return field.placeholder ? Number(field.placeholder) || 0 : 0
  if (field.type === 'select') return field.options?.[0] ?? ''
  return field.placeholder ?? ''
}

function parseDraftValue(type: CustomDraftType, raw: string): FioOptionValue {
  if (type === 'number') return Number(raw) || 0
  if (type === 'boolean') return raw === 'true'
  return raw
}

function CustomParameterSection({
  title,
  params,
  knownKeys,
  onChange,
}: {
  title: string
  params: FioParameterMap
  knownKeys: Set<string>
  onChange: (next: FioParameterMap) => void
}) {
  const [draftKey, setDraftKey] = useState('')
  const [draftValue, setDraftValue] = useState('')
  const [draftType, setDraftType] = useState<CustomDraftType>('text')

  const entries = useMemo(
    () => Object.entries(params).filter(([key]) => !knownKeys.has(key)).sort(([left], [right]) => left.localeCompare(right)),
    [knownKeys, params],
  )

  const updateEntry = (key: string, value: FioOptionValue) => {
    onChange({ ...params, [key]: value })
  }

  const removeEntry = (key: string) => {
    const next = { ...params }
    delete next[key]
    onChange(next)
  }

  const addEntry = () => {
    const key = draftKey.trim()
    if (!key) return
    onChange({ ...params, [key]: parseDraftValue(draftType, draftValue) })
    setDraftKey('')
    setDraftValue('')
    setDraftType('text')
  }

  return (
    <section className="space-y-3 rounded-2xl border border-dashed border-border p-3">
      <div>
        <h4 className="text-sm font-medium">{title}</h4>
        <p className="text-xs text-muted-foreground">参数目录之外的 fio 选项会直接透传给运行配置。</p>
      </div>

      {entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map(([key, value]) => {
            const valueType: CustomDraftType = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text'
            return (
              <div key={key} className="grid gap-2 md:grid-cols-[1.1fr_0.9fr_1.4fr_auto] md:items-center">
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-medium">{key}</div>
                <Select
                  value={valueType}
                  onValueChange={(nextType) => {
                    const nextValue = nextType === 'boolean' ? false : nextType === 'number' ? Number(value) || 0 : String(value)
                    updateEntry(key, nextValue)
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">text</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                  </SelectContent>
                </Select>
                {valueType === 'boolean' ? (
                  <div className="flex h-10 items-center rounded-md border border-border px-3">
                    <Switch checked={Boolean(value)} onCheckedChange={(checked) => updateEntry(key, checked)} />
                  </div>
                ) : (
                  <Input
                    value={String(value)}
                    type={valueType === 'number' ? 'number' : 'text'}
                    onChange={(event) => updateEntry(key, valueType === 'number' ? Number(event.target.value) || 0 : event.target.value)}
                  />
                )}
                <Button variant="ghost" onClick={() => removeEntry(key)}>移除</Button>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">暂无自定义参数。</p>
      )}

      <div className="grid gap-2 md:grid-cols-[1.1fr_0.9fr_1.4fr_auto] md:items-center">
        <Input value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="key，例如 verify_pattern" />
        <Select value={draftType} onValueChange={(value) => setDraftType(value as CustomDraftType)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="text">text</SelectItem>
            <SelectItem value="number">number</SelectItem>
            <SelectItem value="boolean">boolean</SelectItem>
          </SelectContent>
        </Select>
        {draftType === 'boolean' ? (
          <div className="flex h-10 items-center rounded-md border border-border px-3">
            <Switch checked={draftValue === 'true'} onCheckedChange={(checked) => setDraftValue(String(checked))} />
          </div>
        ) : (
          <Input
            value={draftValue}
            type={draftType === 'number' ? 'number' : 'text'}
            onChange={(event) => setDraftValue(event.target.value)}
            placeholder={draftType === 'number' ? 'value，例如 16' : 'value，例如 crc32c'}
          />
        )}
        <Button variant="outline" onClick={addEntry}>添加</Button>
      </div>
    </section>
  )
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FioParameterField
  value: FioOptionValue | undefined
  onChange: (value: FioOptionValue) => void
}) {
  if (field.type === 'boolean') {
    return (
      <div className="flex h-10 items-center rounded-md border border-border px-3">
        <Switch checked={Boolean(value)} onCheckedChange={(checked) => onChange(checked)} />
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <Select value={typeof value === 'string' ? value : undefined} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder={field.placeholder ?? field.label} /></SelectTrigger>
        <SelectContent>
          {(field.options ?? []).map((option) => (
            <SelectItem key={option} value={option}>{option}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <Input
      value={value === undefined ? '' : String(value)}
      type={field.type === 'number' ? 'number' : 'text'}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) || 0 : event.target.value)}
    />
  )
}

export function InspectorPanel({ experimentGlobal, options, stage, job, onUpdateStage, onUpdateJob }: InspectorPanelProps) {
  const [search, setSearch] = useState('')
  const groups = useMemo(() => getParameterGroups(options), [options])
  const knownKeys = useMemo(() => new Set(groups.flatMap((group) => group.fields.map((field) => field.key))), [groups])

  if (!stage) {
    return <p className="text-sm text-muted-foreground">选择一个 Stage 或 Job 开始编辑。</p>
  }

  const resolvedShared = resolveStageSharedParams(experimentGlobal, stage.shared)
  const effectiveJob = job ? resolveEffectiveJobParams(experimentGlobal, stage.shared, job.overrides) : null
  const normalizedSearch = search.trim().toLowerCase()

  const visibleGroups = groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => {
        if (job && !canOverrideAtJobLevel(field.key)) {
          return false
        }
        if (!normalizedSearch) return true
        return field.key.toLowerCase().includes(normalizedSearch) || field.label.toLowerCase().includes(normalizedSearch)
      }),
    }))
    .filter((group) => group.fields.length > 0)

  const updateStageParam = (key: string, value: FioOptionValue) => {
    onUpdateStage({ shared: { ...stage.shared, [key]: value } })
  }

  const clearStageParam = (key: string) => {
    const next = { ...stage.shared }
    delete next[key]
    onUpdateStage({ shared: next })
  }

  const setJobOverride = (key: string, value: FioOptionValue) => {
    if (!job) return
    onUpdateJob({ overrides: { ...job.overrides, [key]: value } })
  }

  const clearJobOverride = (key: string) => {
    if (!job) return
    const next = { ...job.overrides }
    delete next[key]
    onUpdateJob({ overrides: next })
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Stage 名称</Label>
            <Input value={stage.name} onChange={(event) => onUpdateStage({ name: event.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Stage 模式</Label>
            <Select value={stage.mode} onValueChange={(value) => onUpdateStage({ mode: value as ExperimentStage['mode'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sequential">sequential</SelectItem>
                <SelectItem value="parallel">parallel</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          当前 Stage 共享了 {Object.keys(stage.shared).length} 个参数，所有 Job 默认继承这些值。选中 Job 后，只需要填写覆盖项。
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">共享参数</h3>
            <p className="text-xs text-muted-foreground">映射到当前 Stage 的共享配置区域。</p>
          </div>
          <Input className="max-w-56" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索参数 key" />
        </div>

        <div className="space-y-3">
          {visibleGroups.map((group) => (
            <details key={group.id} className="rounded-2xl border border-border p-3" open={!group.collapsedByDefault || normalizedSearch.length > 0}>
              <summary className="cursor-pointer text-sm font-medium">{group.title}</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {group.fields.map((field) => {
                  const isCustomized = field.key in stage.shared
                  const sharedValue = resolvedShared[field.key]
                  return (
                    <div key={field.key} className="space-y-2 rounded-xl border border-border/70 bg-background p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label className="text-xs font-medium">{field.label}</Label>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${isCustomized ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                            {isCustomized ? 'stage' : 'default'}
                          </span>
                          {isCustomized ? <Button size="sm" variant="ghost" onClick={() => clearStageParam(field.key)}>恢复默认</Button> : null}
                        </div>
                      </div>
                      <FieldControl field={field} value={sharedValue} onChange={(value) => updateStageParam(field.key, value)} />
                    </div>
                  )
                })}
              </div>
            </details>
          ))}
        </div>

        <CustomParameterSection
          title="共享区自定义参数"
          params={stage.shared}
          knownKeys={knownKeys}
          onChange={(next) => onUpdateStage({ shared: next })}
        />
      </section>

      {job ? (
        <section className="space-y-3 border-t border-border pt-5">
          <div className="space-y-2">
            <Label>Job 名称</Label>
            <Input value={job.name} onChange={(event) => onUpdateJob({ name: event.target.value })} />
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            当前 Job 有 {Object.keys(job.overrides).length} 个覆盖项；未覆盖字段会继续继承共享参数。
          </div>

          <div className="space-y-3">
            {visibleGroups.map((group) => (
              <details key={`job-${group.id}`} className="rounded-2xl border border-border p-3" open={!group.collapsedByDefault || normalizedSearch.length > 0}>
                <summary className="cursor-pointer text-sm font-medium">Job 覆盖 · {group.title}</summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {group.fields.map((field) => {
                    const overridden = field.key in job.overrides
                    const inherited = resolvedShared[field.key]
                    const displayValue = effectiveJob?.[field.key]
                    return (
                      <div key={`job-${field.key}`} className="space-y-2 rounded-xl border border-border/70 bg-background p-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs font-medium">{field.label}</Label>
                          {overridden ? (
                            <Button size="sm" variant="ghost" onClick={() => clearJobOverride(field.key)}>恢复继承</Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setJobOverride(field.key, emptyValueForField(field, inherited))}>覆盖</Button>
                          )}
                        </div>
                        {overridden ? (
                          <FieldControl field={field} value={displayValue} onChange={(value) => setJobOverride(field.key, value)} />
                        ) : (
                          <div className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                            继承共享值：{formatInherited(inherited)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>
            ))}
          </div>

          <CustomParameterSection
            title="Job 自定义覆盖参数"
            params={job.overrides}
            knownKeys={knownKeys}
            onChange={(next) => onUpdateJob({ overrides: next })}
          />
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          选择一个 Job 后，这里会显示覆盖参数编辑器。每个字段都可以保持继承，或按需覆盖为当前 Job 的特化值。
        </section>
      )}
    </div>
  )
}
