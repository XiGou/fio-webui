import parameterCatalog from '@/data/fio-parameters.json'
import type { OptionsResponse, FioOptionValue } from '@/types/api'
import type { FioParameterMap } from '@/types/experiment'

export type ParameterFieldType = 'text' | 'number' | 'boolean' | 'select'

export interface FioParameterField {
  key: string
  label: string
  type: ParameterFieldType
  options?: string[]
  placeholder?: string
}

export interface FioParameterGroup {
  id: string
  title: string
  collapsedByDefault: boolean
  fields: FioParameterField[]
}

export const TASK_GLOBAL_KEYS = [
  'ioengine',
  'direct',
  'runtime',
  'time_based',
  'group_reporting',
  'log_avg_msec',
  'status_interval',
  'output_format',
] as const

export const JOB_FIELD_KEYS = [
  'filename',
  'rw',
  'bs',
  'size',
  'numjobs',
  'iodepth',
  'rwmixread',
  'rate',
  'runtime',
  'ioengine',
] as const

const TASK_GLOBAL_KEY_SET = new Set<string>(TASK_GLOBAL_KEYS)
const JOB_FIELD_KEY_SET = new Set<string>(JOB_FIELD_KEYS)
const JOB_EXTRA_OVERRIDE_KEYS = new Set<string>(['direct'])

export function resolveStageSharedParams(globalDefaults: FioParameterMap, shared: FioParameterMap): FioParameterMap {
  return { ...globalDefaults, ...shared }
}

export function resolveEffectiveJobParams(globalDefaults: FioParameterMap, shared: FioParameterMap, overrides: FioParameterMap): FioParameterMap {
  return { ...resolveStageSharedParams(globalDefaults, shared), ...overrides }
}

export function buildJobExtraOptions(effective: FioParameterMap, overrides: FioParameterMap): Record<string, FioOptionValue> | undefined {
  const extraOptions: Record<string, FioOptionValue> = {}

  for (const [key, value] of Object.entries(effective)) {
    if (TASK_GLOBAL_KEY_SET.has(key) || JOB_FIELD_KEY_SET.has(key)) {
      continue
    }
    extraOptions[key] = value
  }

  for (const key of JOB_EXTRA_OVERRIDE_KEYS) {
    if (key in overrides) {
      extraOptions[key] = overrides[key]
    }
  }

  return Object.keys(extraOptions).length > 0 ? extraOptions : undefined
}

export function getParameterGroups(options?: OptionsResponse | null): FioParameterGroup[] {
  const ioEngines = options?.io_engines
  const rwTypes = options?.rw_types
  const catalog = parameterCatalog as { groups: FioParameterGroup[] }

  return catalog.groups.map((group) => ({
    ...group,
    fields: group.fields.map((field) => {
      if (field.key === 'ioengine' && ioEngines?.length) {
        return { ...field, options: ioEngines }
      }
      if (field.key === 'rw' && rwTypes?.length) {
        return { ...field, options: rwTypes }
      }
      return field
    }),
  }))
}

export function isTaskGlobalKey(key: string): boolean {
  return TASK_GLOBAL_KEY_SET.has(key)
}

export function isJobFieldKey(key: string): boolean {
  return JOB_FIELD_KEY_SET.has(key)
}

export function isJobExtraOverrideKey(key: string): boolean {
  return JOB_EXTRA_OVERRIDE_KEYS.has(key)
}

export function canOverrideAtJobLevel(key: string): boolean {
  return !isTaskGlobalKey(key) || key === 'ioengine' || key === 'runtime' || isJobExtraOverrideKey(key)
}
