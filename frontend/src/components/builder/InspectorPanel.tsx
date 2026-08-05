import { useMemo, useState } from 'react'
import { Check, ChevronDown, Layers3, Plus, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
  type FioParameterGroup,
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

function FieldControl({
  id,
  field,
  value,
  onChange,
}: {
  id: string
  field: FioParameterField
  value: FioOptionValue | undefined
  onChange: (value: FioOptionValue) => void
}) {
  if (field.type === 'boolean') {
    return (
      <div className="flex h-9 items-center justify-between border border-input bg-background px-3">
        <span className="text-xs text-muted-foreground">{value === true ? '启用' : '关闭'}</span>
        <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <Select value={typeof value === 'string' ? value : undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="h-9"><SelectValue placeholder={field.placeholder ?? field.label} /></SelectTrigger>
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
      id={id}
      className="h-9"
      value={value === undefined ? '' : String(value)}
      type={field.type === 'number' ? 'number' : 'text'}
      placeholder={field.placeholder}
      onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) || 0 : event.target.value)}
    />
  )
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

  const updateEntry = (key: string, value: FioOptionValue) => onChange({ ...params, [key]: value })
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
    <details className="inspector-parameter-group" open={entries.length > 0}>
      <summary>
        <span>{title}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{entries.length}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </summary>
      <div className="divide-y divide-border border-t border-border">
        {entries.map(([key, value]) => {
          const valueType: CustomDraftType = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text'
          return (
            <div key={key} className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate text-[11px] font-semibold">{key}</code>
                <Select
                  value={valueType}
                  onValueChange={(nextType) => {
                    const nextValue = nextType === 'boolean' ? false : nextType === 'number' ? Number(value) || 0 : String(value)
                    updateEntry(key, nextValue)
                  }}
                >
                  <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">text</SelectItem>
                    <SelectItem value="number">number</SelectItem>
                    <SelectItem value="boolean">boolean</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" onClick={() => removeEntry(key)} title={`移除 ${key}`} aria-label={`移除 ${key}`}><Trash2 /></Button>
              </div>
              {valueType === 'boolean' ? (
                <div className="flex h-9 items-center justify-between border border-input px-3 text-xs text-muted-foreground">
                  {value === true ? '启用' : '关闭'}
                  <Switch checked={value === true} onCheckedChange={(checked) => updateEntry(key, checked)} />
                </div>
              ) : (
                <Input className="h-9" value={String(value)} type={valueType === 'number' ? 'number' : 'text'} onChange={(event) => updateEntry(key, valueType === 'number' ? Number(event.target.value) || 0 : event.target.value)} />
              )}
            </div>
          )
        })}

        <div className="space-y-2 bg-muted/30 p-3">
          <div className="flex gap-2">
            <Input className="h-9 min-w-0 flex-1" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} placeholder="参数 key" />
            <Select value={draftType} onValueChange={(value) => setDraftType(value as CustomDraftType)}>
              <SelectTrigger className="h-9 w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="text">text</SelectItem>
                <SelectItem value="number">number</SelectItem>
                <SelectItem value="boolean">boolean</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            {draftType === 'boolean' ? (
              <div className="flex h-9 min-w-0 flex-1 items-center justify-between border border-input bg-background px-3 text-xs text-muted-foreground">
                {draftValue === 'true' ? '启用' : '关闭'}
                <Switch checked={draftValue === 'true'} onCheckedChange={(checked) => setDraftValue(String(checked))} />
              </div>
            ) : (
              <Input className="h-9 min-w-0 flex-1" value={draftValue} type={draftType === 'number' ? 'number' : 'text'} onChange={(event) => setDraftValue(event.target.value)} placeholder="参数值" />
            )}
            <Button size="icon" variant="outline" className="h-9 w-9" onClick={addEntry} disabled={!draftKey.trim()} title="添加自定义参数" aria-label="添加自定义参数"><Plus /></Button>
          </div>
        </div>
      </div>
    </details>
  )
}

function ParameterGroup({
  group,
  scope,
  stage,
  job,
  sharedValues,
  effectiveJob,
  onUpdateStage,
  onUpdateJob,
  forceOpen,
}: {
  group: FioParameterGroup
  scope: 'stage' | 'job'
  stage: ExperimentStage
  job: ExperimentJob | null
  sharedValues: FioParameterMap
  effectiveJob: FioParameterMap | null
  onUpdateStage: (patch: Partial<ExperimentStage>) => void
  onUpdateJob: (patch: Partial<ExperimentJob>) => void
  forceOpen: boolean
}) {
  const updateStageParam = (key: string, value: FioOptionValue) => onUpdateStage({ shared: { ...stage.shared, [key]: value } })
  const clearStageParam = (key: string) => {
    const next = { ...stage.shared }
    delete next[key]
    onUpdateStage({ shared: next })
  }
  const setJobOverride = (key: string, value: FioOptionValue) => {
    if (job) onUpdateJob({ overrides: { ...job.overrides, [key]: value } })
  }
  const clearJobOverride = (key: string) => {
    if (!job) return
    const next = { ...job.overrides }
    delete next[key]
    onUpdateJob({ overrides: next })
  }
  const configuredCount = group.fields.filter((field) => scope === 'job' ? Boolean(job && field.key in job.overrides) : field.key in stage.shared).length

  return (
    <details className="inspector-parameter-group" open={forceOpen || !group.collapsedByDefault}>
      <summary>
        <span>{group.title}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">{configuredCount}/{group.fields.length}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </summary>
      <div className="divide-y divide-border border-t border-border">
        {group.fields.map((field) => {
          const inherited = sharedValues[field.key]
          const overridden = Boolean(job && field.key in job.overrides)
          const customized = field.key in stage.shared
          const active = scope === 'job' ? overridden : true
          const value = scope === 'job' ? effectiveJob?.[field.key] : inherited
          const controlId = `${scope}-field-${field.key}`

          return (
            <div key={field.key} className="inspector-field-row">
              <div className="flex min-w-0 items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Label htmlFor={controlId} className="block truncate text-xs font-medium">{field.label}</Label>
                  <code className="mt-0.5 block truncate text-[9px] text-muted-foreground">{field.key}</code>
                </div>
                {scope === 'job' ? (
                  <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                    覆盖
                    <Switch
                      checked={overridden}
                      onCheckedChange={(checked) => checked ? setJobOverride(field.key, emptyValueForField(field, inherited)) : clearJobOverride(field.key)}
                      aria-label={`${overridden ? '取消' : '启用'} ${field.label} 覆盖`}
                    />
                  </label>
                ) : customized ? (
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => clearStageParam(field.key)}>恢复默认</Button>
                ) : <Badge>默认</Badge>}
              </div>

              {scope === 'job' && !active ? (
                <div className="flex h-9 items-center justify-between border border-dashed border-border bg-muted/20 px-3 text-xs text-muted-foreground">
                  <span className="truncate">继承 {formatInherited(inherited)}</span>
                  <Check className="h-3.5 w-3.5 shrink-0" />
                </div>
              ) : (
                <FieldControl id={controlId} field={field} value={value} onChange={(next) => scope === 'job' ? setJobOverride(field.key, next) : updateStageParam(field.key, next)} />
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}

export function InspectorPanel({ experimentGlobal, options, stage, job, onUpdateStage, onUpdateJob }: InspectorPanelProps) {
  const [search, setSearch] = useState('')
  const groups = useMemo(() => getParameterGroups(options), [options])
  const knownKeys = useMemo(() => new Set(groups.flatMap((group) => group.fields.map((field) => field.key))), [groups])

  if (!stage) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center border border-dashed border-border bg-muted/20 px-6 text-center">
        <SlidersHorizontal className="mb-3 h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-medium">未选择配置模块</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">从画布选择节点或 Job。</p>
      </div>
    )
  }

  const scope = job ? 'job' : 'stage'
  const resolvedShared = resolveStageSharedParams(experimentGlobal, stage.shared)
  const effectiveJob = job ? resolveEffectiveJobParams(experimentGlobal, stage.shared, job.overrides) : null
  const normalizedSearch = search.trim().toLowerCase()
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      fields: group.fields.filter((field) => {
        if (job && !canOverrideAtJobLevel(field.key)) return false
        if (!normalizedSearch) return true
        return field.key.toLowerCase().includes(normalizedSearch) || field.label.toLowerCase().includes(normalizedSearch)
      }),
    }))
    .filter((group) => group.fields.length > 0)
  const configuredCount = job ? Object.keys(job.overrides).length : Object.keys(stage.shared).length

  return (
    <div className="space-y-3">
      <section className="inspector-module-header">
        <span className="module-icon">{job ? <SlidersHorizontal /> : <Layers3 />}</span>
        <div className="min-w-0 flex-1">
          <strong className="block text-xs">{job ? 'Job 参数' : '节点共享参数'}</strong>
          <small className="block truncate font-mono text-[9px] text-muted-foreground">{stage.name}</small>
        </div>
        <Badge tone={configuredCount > 0 ? 'success' : 'neutral'}>{configuredCount} 项</Badge>
      </section>

      <section className="space-y-2 border-y border-border bg-muted/25 p-3">
        <Label htmlFor="inspector-module-name">{job ? 'Job 名称' : '节点名称'}</Label>
        <Input
          id="inspector-module-name"
          className="h-9 bg-background"
          value={job?.name ?? stage.name}
          onChange={(event) => job ? onUpdateJob({ name: event.target.value }) : onUpdateStage({ name: event.target.value })}
        />
        <p className="text-[10px] leading-4 text-muted-foreground">
          {job
            ? `继承节点共享值，仅 ${configuredCount} 个参数由当前 Job 覆盖。`
            : `节点内 ${stage.jobs.length} 个 Job 并行执行，共享值会被所有 Job 继承。`}
        </p>
      </section>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input className="h-9 bg-background pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 fio 参数" />
      </div>

      <div className="space-y-2">
        {visibleGroups.map((group) => (
          <ParameterGroup
            key={group.id}
            group={group}
            scope={scope}
            stage={stage}
            job={job}
            sharedValues={resolvedShared}
            effectiveJob={effectiveJob}
            onUpdateStage={onUpdateStage}
            onUpdateJob={onUpdateJob}
            forceOpen={normalizedSearch.length > 0}
          />
        ))}
        {visibleGroups.length === 0 ? <p className="border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">没有匹配的参数。</p> : null}
      </div>

      <CustomParameterSection
        title={job ? 'Job 自定义覆盖' : '节点自定义参数'}
        params={job?.overrides ?? stage.shared}
        knownKeys={knownKeys}
        onChange={(next) => job ? onUpdateJob({ overrides: next }) : onUpdateStage({ shared: next })}
      />
    </div>
  )
}
