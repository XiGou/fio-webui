import { describe, expect, it } from 'vitest'
import { compileExperimentToTaskList } from './experimentCompiler'
import { resolveEffectiveJobParams } from './fioParameters'
import type { Experiment } from '@/types/experiment'

describe('resolveEffectiveJobParams', () => {
  it('merges experiment defaults, stage shared params, and job overrides', () => {
    const effective = resolveEffectiveJobParams(
      {
        ioengine: 'io_uring',
        runtime: 60,
        direct: true,
      },
      {
        rw: 'randread',
        bs: '128k',
        filename: '/dev/nvme0n1',
        iodepth: 16,
        verify: 'crc32c',
      },
      {
        rw: 'randwrite',
        iodepth: 64,
        offset_increment: '1G',
      },
    )

    expect(effective).toEqual({
      ioengine: 'io_uring',
      runtime: 60,
      direct: true,
      rw: 'randwrite',
      bs: '128k',
      filename: '/dev/nvme0n1',
      iodepth: 64,
      verify: 'crc32c',
      offset_increment: '1G',
    })
  })
})

describe('compileExperimentToTaskList with shared params', () => {
  it('compiles shared params into global defaults and resolved job values', () => {
    const experiment: Experiment = {
      id: 'exp-1',
      name: 'shared-vs-override',
      global: {
        ioengine: 'io_uring',
        direct: true,
        runtime: 90,
        time_based: true,
        group_reporting: true,
        log_avg_msec: 500,
        status_interval: 1,
        output_format: 'json',
      },
      stages: [
        {
          id: 'stage-1',
          name: 'Mixed RW',
          mode: 'parallel',
          shared: {
            filename: '/dev/nvme0n1',
            size: '8G',
            rw: 'randread',
            bs: '128k',
            numjobs: 2,
            iodepth: 16,
            verify: 'crc32c',
          },
          jobs: [
            { id: 'job-1', name: 'readers', overrides: {} },
            { id: 'job-2', name: 'writers', overrides: { rw: 'randwrite', iodepth: 64, verify: 'md5' } },
          ],
        },
      ],
    }

    const result = compileExperimentToTaskList(experiment)

    expect(result.errors).toHaveLength(0)
    expect(result.taskList.tasks).toHaveLength(1)
    expect(result.taskList.tasks[0].global).toMatchObject({
      ioengine: 'io_uring',
      direct: true,
      runtime: 90,
      time_based: true,
      group_reporting: true,
      log_avg_msec: 500,
      status_interval: 1,
      output_format: 'json',
    })
    expect(result.taskList.tasks[0].jobs[0]).toMatchObject({
      name: 'readers',
      filename: '/dev/nvme0n1',
      size: '8G',
      rw: 'randread',
      bs: '128k',
      numjobs: 2,
      iodepth: 16,
    })
    expect(result.taskList.tasks[0].jobs[0].extra_options).toEqual({
      verify: 'crc32c',
    })
    expect(result.taskList.tasks[0].jobs[1]).toMatchObject({
      name: 'writers',
      filename: '/dev/nvme0n1',
      size: '8G',
      rw: 'randwrite',
      bs: '128k',
      numjobs: 2,
      iodepth: 64,
    })
    expect(result.taskList.tasks[0].jobs[1].extra_options).toEqual({
      verify: 'md5',
    })
  })

  it('compiles non-native job overrides into extra_options', () => {
    const experiment: Experiment = {
      id: 'exp-2',
      name: 'job-extra-options',
      global: {
        ioengine: 'libaio',
        direct: true,
        runtime: 60,
        time_based: true,
        group_reporting: true,
        log_avg_msec: 500,
        status_interval: 1,
        output_format: 'json',
      },
      stages: [
        {
          id: 'stage-1',
          name: 'Overrides',
          mode: 'parallel',
          shared: {
            filename: '/tmp/fio-test',
            rw: 'randread',
            bs: '4k',
            size: '1G',
            buffered: false,
          },
          jobs: [
            {
              id: 'job-1',
              name: 'job-1',
              overrides: {
                direct: false,
                offset: '1G',
                rate_iops: 32000,
              },
            },
          ],
        },
      ],
    }

    const result = compileExperimentToTaskList(experiment)

    expect(result.errors).toHaveLength(0)
    expect(result.taskList.tasks[0].jobs[0].extra_options).toEqual({
      buffered: false,
      direct: false,
      offset: '1G',
      rate_iops: 32000,
    })
  })
})
