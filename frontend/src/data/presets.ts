import type { FioTask, JobConfig } from '../types/api'

/** Preset workload definition for common storage test scenarios */
export interface PresetWorkload {
  id: string
  name: string
  description: string
  category: 'random' | 'sequential' | 'mixed' | 'comprehensive'
  /** Human-readable config summary, e.g. "4K, iodepth 32" */
  configSummary: string
  /** If true, jobs run sequentially (stonewall between each) */
  stonewallBetweenJobs?: boolean
  task: FioTask
}

const defaultGlobal = {
  ioengine: 'libaio',
  direct: true,
  runtime: 60,
  time_based: true,
  group_reporting: true,
  log_avg_msec: 500,
  output_format: 'json' as const,
  status_interval: 1,
}

const baseJob = (overrides: Partial<JobConfig>): JobConfig => ({
  name: 'job1',
  filename: '/tmp/fio-test',
  rw: 'randread',
  bs: '4k',
  size: '1G',
  numjobs: 1,
  iodepth: 32,
  rwmixread: 70,
  ...overrides,
})

/** Common storage benchmark presets based on industry-standard fio workloads */
export const PRESETS: PresetWorkload[] = [
  // === Random workloads (4K - typical for metadata, small block) ===
  {
    id: '4k-randread',
    name: '4K 随机读',
    description: '4K 块大小随机读，模拟数据库索引、元数据、小文件随机访问等场景，是 SSD/HDD 最常用的基准测试之一。',
    category: 'random',
    configSummary: 'bs=4k, iodepth=32, rw=randread',
    task: {
      name: '4k-randread',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randread', rw: 'randread', bs: '4k', iodepth: 32 })],
    },
  },
  {
    id: '4k-randwrite',
    name: '4K 随机写',
    description: '4K 随机写是区分存储品质的关键测试，差劲的 SSD 在随机写场景下性能会明显下降。',
    category: 'random',
    configSummary: 'bs=4k, iodepth=32, rw=randwrite',
    task: {
      name: '4k-randwrite',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randwrite', rw: 'randwrite', bs: '4k', iodepth: 32 })],
    },
  },

  // === Random workloads (8K) ===
  {
    id: '8k-randread',
    name: '8K 随机读',
    description: '8K 块随机读，常见于数据库日志、中等大小块访问场景。',
    category: 'random',
    configSummary: 'bs=8k, iodepth=32, rw=randread',
    task: {
      name: '8k-randread',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randread', rw: 'randread', bs: '8k', iodepth: 32 })],
    },
  },
  {
    id: '8k-randwrite',
    name: '8K 随机写',
    description: '8K 随机写，模拟应用层中等块写入。',
    category: 'random',
    configSummary: 'bs=8k, iodepth=32, rw=randwrite',
    task: {
      name: '8k-randwrite',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randwrite', rw: 'randwrite', bs: '8k', iodepth: 32 })],
    },
  },

  // === Random workloads (256K - large block) ===
  {
    id: '256k-randread',
    name: '256K 随机读',
    description: '256K 大块随机读，测试大块 I/O 场景，如视频流、大文件片段读取。',
    category: 'random',
    configSummary: 'bs=256k, iodepth=16, rw=randread',
    task: {
      name: '256k-randread',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randread', rw: 'randread', bs: '256k', iodepth: 16 })],
    },
  },
  {
    id: '256k-randwrite',
    name: '256K 随机写',
    description: '256K 大块随机写，大块写入场景的带宽与延迟测试。',
    category: 'random',
    configSummary: 'bs=256k, iodepth=16, rw=randwrite',
    task: {
      name: '256k-randwrite',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randwrite', rw: 'randwrite', bs: '256k', iodepth: 16 })],
    },
  },

  // === Sequential workloads ===
  {
    id: 'seq-read',
    name: '顺序读',
    description: '顺序读取，测试顺序读带宽，常用于大文件、日志、流式读取场景。通常块大小为 1M 以测最大吞吐。',
    category: 'sequential',
    configSummary: 'bs=1m, iodepth=4, rw=read',
    task: {
      name: 'seq-read',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'seqread', rw: 'read', bs: '1m', iodepth: 4 })],
    },
  },
  {
    id: 'seq-write',
    name: '顺序写',
    description: '顺序写入，测试顺序写带宽，如大文件备份、日志写入等。',
    category: 'sequential',
    configSummary: 'bs=1m, iodepth=4, rw=write',
    task: {
      name: 'seq-write',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'seqwrite', rw: 'write', bs: '1m', iodepth: 4 })],
    },
  },
  {
    id: '4k-seq-read',
    name: '4K 顺序读',
    description: '4K 块顺序读，小块顺序访问场景。',
    category: 'sequential',
    configSummary: 'bs=4k, iodepth=4, rw=read',
    task: {
      name: '4k-seq-read',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'seqread', rw: 'read', bs: '4k', iodepth: 4 })],
    },
  },
  {
    id: '4k-seq-write',
    name: '4K 顺序写',
    description: '4K 块顺序写。',
    category: 'sequential',
    configSummary: 'bs=4k, iodepth=4, rw=write',
    task: {
      name: '4k-seq-write',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'seqwrite', rw: 'write', bs: '4k', iodepth: 4 })],
    },
  },

  // === Mixed read/write ===
  {
    id: '8k-randrw-70-30',
    name: '8K 随机读写 70/30',
    description: '8K 混合随机读写，70% 读 30% 写，模拟典型数据库或应用混合负载。',
    category: 'mixed',
    configSummary: 'bs=8k, rw=randrw, rwmixread=70',
    task: {
      name: '8k-randrw',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randrw', rw: 'randrw', bs: '8k', iodepth: 32, rwmixread: 70 })],
    },
  },
  {
    id: '16k-randrw-90-10',
    name: '16K 随机读写 90/10',
    description: '90% 读 10% 写，读多写少的应用场景（如缓存、CDN 边缘）。',
    category: 'mixed',
    configSummary: 'bs=16k, rw=randrw, rwmixread=90',
    task: {
      name: '16k-randrw',
      global: defaultGlobal,
      jobs: [baseJob({ name: 'randrw', rw: 'randrw', bs: '16k', iodepth: 32, rwmixread: 90 })],
    },
  },

  // === Comprehensive SSD test (multiple jobs with stonewall) ===
  {
    id: 'ssd-full',
    name: 'SSD 完整测试',
    description: '按 fio 官方 ssd-test 示例：顺序读、随机读、顺序写、随机写，依次执行（stonewall）。可全面评估 SSD 的读写性能，随机写是区分好坏盘的关键指标。',
    category: 'comprehensive',
    configSummary: '4 jobs: seq-read, rand-read, seq-write, rand-write, bs=4k, iodepth=4',
    /** If true, insert stonewall after each job except the last (sequential execution) */
    stonewallBetweenJobs: true,
    task: {
      name: 'ssd-full',
      global: { ...defaultGlobal, runtime: 60 },
      jobs: [
        baseJob({ name: 'seq-read', rw: 'read', bs: '4k', iodepth: 4 }),
        baseJob({ name: 'rand-read', rw: 'randread', bs: '4k', iodepth: 4 }),
        baseJob({ name: 'seq-write', rw: 'write', bs: '4k', iodepth: 4 }),
        baseJob({ name: 'rand-write', rw: 'randwrite', bs: '4k', iodepth: 4 }),
      ],
    },
  },
]

