import type { FioTaskList, GlobalConfig, JobConfig } from '@/types/api'
import type { Experiment, ExperimentJob } from '@/types/experiment'

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
  filename: '/tmp/fio-test',
  rw: 'randread',
  bs: '4k',
  size: '1G',
  numjobs: 1,
  iodepth: 32,
  rwmixread: 70,
})

export const defaultExperiment = (): Experiment => ({
  id: `exp-${uid()}`,
  name: 'AI Harness Experiment',
  description: 'Stage-based fio experiment',
  global: { ...DEFAULT_GLOBAL },
  stages: [
    {
      id: `stage-${uid()}`,
      name: 'Warmup',
      mode: 'sequential',
      jobs: [defaultJob()],
    },
  ],
})

export function compileExperimentToTaskList(experiment: Experiment): CompileExperimentResult {
  const errors: string[] = []
  const warnings: string[] = []
  const taskList: FioTaskList = { tasks: [] }

  if (!experiment.stages.length) {
    errors.push('至少需要 1 个 Stage。')
    return { taskList, errors, warnings }
  }

  for (const stage of experiment.stages) {
    if (!stage.jobs.length) {
      errors.push(`Stage "${stage.name}" 至少需要 1 个 Job。`)
      continue
    }

    const global: GlobalConfig = { ...experiment.global, ...(stage.global ?? {}) }
    const jobs: JobConfig[] = stage.jobs.map((job, idx) => ({
      name: job.name || `job-${idx + 1}`,
      filename: job.filename || '/tmp/fio-test',
      rw: job.rw || 'read',
      bs: job.bs || '4k',
      size: job.size || '1G',
      numjobs: Number(job.numjobs || 1),
      iodepth: Number(job.iodepth || 1),
      rwmixread: Number(job.rwmixread ?? 70),
      rate: job.rate || '',
      runtime: job.runtime,
      ioengine: job.ioengine,
    }))

    if (stage.mode === 'sequential') {
      for (let i = 0; i < jobs.length; i++) {
        jobs[i] = { ...jobs[i], stonewallAfter: i !== jobs.length - 1 }
      }
    }

    taskList.tasks.push({
      name: stage.name || `stage-${taskList.tasks.length + 1}`,
      global,
      jobs,
    })
  }

  if (!taskList.tasks.length) {
    errors.push('编译后没有可执行任务。')
  }

  return { taskList, errors, warnings }
}
