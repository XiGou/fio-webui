import { describe, expect, it } from 'vitest'
import { compileExperimentToTaskList, defaultExperiment, defaultStage, experimentFromTaskList } from './experimentCompiler'

describe('compileExperimentToTaskList', () => {
  it('compiles jobs in a node in parallel and nodes as ordered tasks', () => {
    const exp = defaultExperiment()
    exp.stages[0].jobs = [
      { ...exp.stages[0].jobs[0], id: 'j1', name: 'j1', overrides: { ...exp.stages[0].jobs[0].overrides } },
      { ...exp.stages[0].jobs[0], id: 'j2', name: 'j2', overrides: { ...exp.stages[0].jobs[0].overrides } },
    ]
    exp.stages.push({ ...defaultStage(), id: 'stage-2', name: '测量' })

    const result = compileExperimentToTaskList(exp)
    expect(result.errors).toHaveLength(0)
    expect(result.taskList.tasks).toHaveLength(2)
    expect(result.taskList.tasks[0].jobs).toHaveLength(2)
    expect(result.taskList.tasks[0].jobs.every((job) => !job.stonewallAfter)).toBe(true)
    expect(result.taskList.tasks.map((task) => task.name)).toEqual(['预热', '测量'])
  })

  it('returns error when stage has no jobs', () => {
    const exp = defaultExperiment()
    exp.stages[0].jobs = []
    const result = compileExperimentToTaskList(exp)
    expect(result.errors[0]).toContain('至少需要 1 个 Job')
  })
})

describe('experimentFromTaskList', () => {
  it('splits imported stonewall barriers into ordered nodes', () => {
    const restored = experimentFromTaskList({
      tasks: [{
        name: 'legacy',
        global: { ioengine: 'io_uring', direct: true, runtime: 30, log_avg_msec: 500 },
        jobs: [
          { name: 'first', filename: '/tmp/a', rw: 'read', bs: '4k', size: '1G', numjobs: 1, iodepth: 1, rwmixread: 100, stonewallAfter: true },
          { name: 'second', filename: '/tmp/a', rw: 'read', bs: '4k', size: '1G', numjobs: 1, iodepth: 1, rwmixread: 100 },
        ],
      }],
    })

    expect(restored.stages).toHaveLength(2)
    expect(restored.stages.map((stage) => stage.jobs.map((job) => job.name))).toEqual([['first'], ['second']])
    expect(compileExperimentToTaskList(restored).taskList.tasks).toHaveLength(2)
  })

  it('preserves per-stage global differences when restoring a workflow', () => {
    const restored = experimentFromTaskList({
      tasks: [
        {
          name: 'warmup',
          global: { ioengine: 'io_uring', direct: true, runtime: 30, log_avg_msec: 500 },
          jobs: [{ name: 'read', filename: '/tmp/a', rw: 'read', bs: '4k', size: '1G', numjobs: 1, iodepth: 1, rwmixread: 100 }],
        },
        {
          name: 'measure',
          global: { ioengine: 'libaio', direct: false, runtime: 120, log_avg_msec: 1000 },
          jobs: [{ name: 'mixed', filename: '/tmp/a', rw: 'randrw', bs: '8k', size: '1G', numjobs: 4, iodepth: 32, rwmixread: 70 }],
        },
      ],
    })

    const recompiled = compileExperimentToTaskList(restored)
    expect(recompiled.taskList.tasks[0].global).toMatchObject({ ioengine: 'io_uring', direct: true, runtime: 30, log_avg_msec: 500 })
    expect(recompiled.taskList.tasks[1].global).toMatchObject({ ioengine: 'libaio', direct: false, runtime: 120, log_avg_msec: 1000 })
  })
})
