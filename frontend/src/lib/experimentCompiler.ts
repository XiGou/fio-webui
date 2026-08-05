import type { FioTaskList, GlobalConfig, JobConfig } from '@/types/api'
import type { Experiment, ExperimentJob, FioParameterMap } from '@/types/experiment'
import { buildJobExtraOptions, resolveEffectiveJobParams, resolveStageSharedParams } from './fioParameters'

export type CompileExperimentResult = {
  taskList: FioTaskList
  errors: string[]
  warnings: string[]
}

const uid = () => (typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export const DEFAULT_GLOBAL: GlobalConfig = {
  ioengine: 'io_uring',
  direct: true,
  runtime: 60,
  time_based: true,
  group_reporting: true,
  log_avg_msec: 500,
  status_interval: 1,
  output_format: 'json',
}

export const defaultJob = (): ExperimentJob => ({
  id: `job-${uid()}`,
  name: 'randread-4k',
  overrides: {
    rw: 'randread',
    bs: '4k',
    rwmixread: 70,
  },
})

export const defaultExperiment = (): Experiment => ({
  id: `exp-${uid()}`,
  name: 'NVMe 基准验证',
  description: '可复用的 fio 测试流水线',
  global: { ...DEFAULT_GLOBAL },
  stages: [defaultStage()],
})

export const defaultStage = () => ({
  id: `stage-${uid()}`,
  name: '预热',
  shared: {
    filename: '/tmp/fio-test',
    size: '1G',
    numjobs: 1,
    iodepth: 32,
  },
  jobs: [defaultJob()],
})

const DEFAULT_JOB_PARAMS: FioParameterMap = {
  filename: '/tmp/fio-test',
  rw: 'read',
  bs: '4k',
  size: '1G',
  numjobs: 1,
  iodepth: 1,
  rwmixread: 70,
}

function splitJobsAtBarriers(jobs: JobConfig[]): JobConfig[][] {
  if (!jobs.length) return [[]]

  const segments: JobConfig[][] = []
  let current: JobConfig[] = []
  for (const job of jobs) {
    current.push(job)
    if (job.stonewallAfter) {
      segments.push(current)
      current = []
    }
  }
  if (current.length) segments.push(current)
  return segments
}

export function experimentFromTaskList(taskList: FioTaskList, sourceRunId?: string): Experiment {
  const firstGlobal = taskList.tasks[0]?.global ?? DEFAULT_GLOBAL
  return {
    id: `exp-${uid()}`,
    name: sourceRunId ? `运行 ${sourceRunId.slice(0, 8)} 的副本` : '恢复的测试流水线',
    description: sourceRunId ? `由历史运行 ${sourceRunId} 恢复` : '由 fio 任务列表恢复',
    global: { ...firstGlobal },
    stages: taskList.tasks.flatMap((task, taskIndex) => {
      const segments = splitJobsAtBarriers(task.jobs)
      const baseName = task.name || `节点 ${taskIndex + 1}`
      const shared = Object.fromEntries(
        Object.entries(task.global).filter(([key, value]) => value !== firstGlobal[key as keyof GlobalConfig]),
      ) as FioParameterMap

      return segments.map((jobs, segmentIndex) => ({
        id: `stage-${uid()}-${taskIndex}-${segmentIndex}`,
        name: segments.length === 1 ? baseName : `${baseName} · ${segmentIndex + 1}`,
        shared: { ...shared },
        jobs: jobs.map((job, jobIndex) => ({
          id: `job-${uid()}-${taskIndex}-${segmentIndex}-${jobIndex}`,
          name: job.name || `job-${jobIndex + 1}`,
          overrides: {
            filename: job.filename,
            rw: job.rw,
            bs: job.bs,
            size: job.size,
            numjobs: job.numjobs,
            iodepth: job.iodepth,
            rwmixread: job.rwmixread,
            ...(job.rate ? { rate: job.rate } : {}),
            ...(job.runtime ? { runtime: job.runtime } : {}),
            ...(job.ioengine ? { ioengine: job.ioengine } : {}),
            ...(job.extra_options ?? {}),
          },
        })),
      }))
    }),
  }
}


function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function buildTaskGlobal(shared: FioParameterMap): GlobalConfig {
  return {
    ioengine: asString(shared.ioengine, DEFAULT_GLOBAL.ioengine),
    direct: asBoolean(shared.direct, DEFAULT_GLOBAL.direct),
    runtime: asNumber(shared.runtime, DEFAULT_GLOBAL.runtime),
    time_based: asBoolean(shared.time_based, DEFAULT_GLOBAL.time_based ?? true),
    group_reporting: asBoolean(shared.group_reporting, DEFAULT_GLOBAL.group_reporting ?? true),
    log_avg_msec: asNumber(shared.log_avg_msec, DEFAULT_GLOBAL.log_avg_msec),
    status_interval: asNumber(shared.status_interval, DEFAULT_GLOBAL.status_interval ?? 1),
    output_format: asString(shared.output_format, DEFAULT_GLOBAL.output_format ?? 'json'),
  }
}

function buildResolvedJob(name: string, effective: FioParameterMap, overrides: FioParameterMap, idx: number): JobConfig {
  return {
    name: name || `job-${idx + 1}`,
    filename: asString(effective.filename, asString(DEFAULT_JOB_PARAMS.filename, '/tmp/fio-test')),
    rw: asString(effective.rw, asString(DEFAULT_JOB_PARAMS.rw, 'read')),
    bs: asString(effective.bs, asString(DEFAULT_JOB_PARAMS.bs, '4k')),
    size: asString(effective.size, asString(DEFAULT_JOB_PARAMS.size, '1G')),
    numjobs: asNumber(effective.numjobs, asNumber(DEFAULT_JOB_PARAMS.numjobs, 1)),
    iodepth: asNumber(effective.iodepth, asNumber(DEFAULT_JOB_PARAMS.iodepth, 1)),
    rwmixread: asNumber(effective.rwmixread, asNumber(DEFAULT_JOB_PARAMS.rwmixread, 70)),
    rate: typeof effective.rate === 'string' ? effective.rate : '',
    runtime: 'runtime' in overrides ? asNumber(overrides.runtime, 0) : undefined,
    ioengine: typeof overrides.ioengine === 'string' ? overrides.ioengine : undefined,
    extra_options: buildJobExtraOptions(effective, overrides),
  }
}

export function compileExperimentToTaskList(experiment: Experiment): CompileExperimentResult {
  const errors: string[] = []
  const warnings: string[] = []
  const taskList: FioTaskList = { tasks: [] }

  if (!experiment.stages.length) {
    errors.push('至少需要 1 个节点。')
    return { taskList, errors, warnings }
  }

  for (const stage of experiment.stages) {
    if (!stage.jobs.length) {
      errors.push(`节点 "${stage.name}" 至少需要 1 个 Job。`)
      continue
    }

    const shared = resolveStageSharedParams(experiment.global, stage.shared)
    const global = buildTaskGlobal(shared)
    const jobs: JobConfig[] = stage.jobs.map((job, idx) => {
      const effective = resolveEffectiveJobParams(experiment.global, stage.shared, job.overrides)
      return buildResolvedJob(job.name, effective, job.overrides, idx)
    })

    taskList.tasks.push({
      name: stage.name || `node-${taskList.tasks.length + 1}`,
      global,
      jobs,
    })
  }

  if (!taskList.tasks.length) {
    errors.push('编译后没有可执行任务。')
  }

  return { taskList, errors, warnings }
}
