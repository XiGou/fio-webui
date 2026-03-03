import type { PresetWorkload } from '../data/presets'
import type { JobConfig } from '../types/api'

const USER_PRESETS_KEY = 'fio-webui:user-presets:v1'

function safeWindow(): Window | null {
  if (typeof window === 'undefined') return null
  return window
}

export function loadUserPresets(): PresetWorkload[] {
  const w = safeWindow()
  if (!w) return []
  try {
    const raw = w.localStorage.getItem(USER_PRESETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Best-effort validation
    return parsed.filter((p) => typeof p?.id === 'string' && typeof p?.name === 'string')
  } catch {
    return []
  }
}

function saveUserPresets(list: PresetWorkload[]) {
  const w = safeWindow()
  if (!w) return
  try {
    w.localStorage.setItem(USER_PRESETS_KEY, JSON.stringify(list))
  } catch {
    // ignore quota / privacy errors
  }
}

export function addUserPreset(preset: PresetWorkload): void {
  const list = loadUserPresets()
  const next = [...list, preset]
  saveUserPresets(next)
}

export function removeUserPreset(id: string): PresetWorkload[] {
  const list = loadUserPresets()
  const next = list.filter((p) => p.id !== id)
  saveUserPresets(next)
  return next
}

export function updateUserPreset(id: string, patch: Partial<PresetWorkload>): PresetWorkload[] {
  const list = loadUserPresets()
  const next = list.map((p) => (p.id === id ? { ...p, ...patch } : p))
  saveUserPresets(next)
  return next
}

export function buildConfigSummaryFromJobs(jobs: JobConfig[]): string {
  if (!jobs.length) return 'empty task'
  const j = jobs[0]
  const parts = [
    `bs=${j.bs}`,
    `rw=${j.rw}`,
    `iodepth=${j.iodepth}`,
    `numjobs=${j.numjobs}`,
  ]
  return parts.join(', ')
}

