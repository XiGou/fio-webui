import { describe, expect, it } from 'vitest'
import { compileExperimentToTaskList, defaultExperiment } from './experimentCompiler'

describe('compileExperimentToTaskList', () => {
  it('injects stonewall in sequential stage except last job', () => {
    const exp = defaultExperiment()
    exp.stages[0].mode = 'sequential'
    exp.stages[0].jobs = [
      { ...exp.stages[0].jobs[0], id: 'j1', name: 'j1', overrides: { ...exp.stages[0].jobs[0].overrides } },
      { ...exp.stages[0].jobs[0], id: 'j2', name: 'j2', overrides: { ...exp.stages[0].jobs[0].overrides } },
    ]

    const result = compileExperimentToTaskList(exp)
    expect(result.errors).toHaveLength(0)
    expect(result.taskList.tasks[0].jobs[0].stonewallAfter).toBe(true)
    expect(result.taskList.tasks[0].jobs[1].stonewallAfter).toBe(false)
  })

  it('returns error when stage has no jobs', () => {
    const exp = defaultExperiment()
    exp.stages[0].jobs = []
    const result = compileExperimentToTaskList(exp)
    expect(result.errors[0]).toContain('至少需要 1 个 Job')
  })
})
