import type { FioTask, JobConfig } from '../types/api'

/** Preset workload definition for common storage test scenarios */
export interface PresetWorkload {
  id: string
  name: string
  description: string
  category:
    | 'random'
    | 'sequential'
    | 'mixed'
    | 'comprehensive'
    | 'database'
    | 'kv'
    | 'logging'
    | 'docker'
    | 'ci'
    | 'ai'
    | 'web'
    | 'user'
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

  // === Application-style workloads: databases, KV stores, logs, containers, CI, AI, web ===

  // -- Databases (OLTP / OLAP-like) --
  {
    id: 'db-oltp-8k-randrw-70-30',
    name: '数据库 OLTP（8K 随机读写 70/30）',
    description:
      '模拟典型关系型数据库 OLTP 负载：以 8K 块为主，读多写少，较高并发和队列深度，适合评估数据库数据文件所在盘的随机 I/O 能力。',
    category: 'database',
    configSummary: 'bs=8k, rw=randrw, rwmixread=70, numjobs=8, iodepth=32',
    task: {
      name: 'db-oltp',
      global: { ...defaultGlobal, runtime: 120 },
      jobs: [
        baseJob({
          name: 'db-oltp-8k',
          filename: '/data/db_oltp.dat',
          rw: 'randrw',
          bs: '8k',
          size: '32G',
          numjobs: 8,
          iodepth: 32,
          rwmixread: 70,
        }),
      ],
    },
  },
  {
    id: 'db-olap-1m-read',
    name: '数据库 OLAP（1M 顺序读）',
    description:
      '模拟数据仓库 / 报表类查询，以 1M 顺序读为主，关注顺序扫盘带宽，适合评估分析型负载的吞吐能力。',
    category: 'database',
    configSummary: 'bs=1m, rw=read, numjobs=4, iodepth=8',
    task: {
      name: 'db-olap',
      global: { ...defaultGlobal, runtime: 120 },
      jobs: [
        baseJob({
          name: 'db-olap-1m-read',
          filename: '/data/db_olap.dat',
          rw: 'read',
          bs: '1m',
          size: '128G',
          numjobs: 4,
          iodepth: 8,
        }),
      ],
    },
  },

  // -- KV store / cache-style --
  {
    id: 'kv-small-4k-randrw-90-10',
    name: 'KV 存储（4K 随机读写 90/10）',
    description:
      '模拟以读为主的 KV / 缓存系统（如 Redis / RocksDB），4K 小块随机 I/O，90% 读 10% 写，高并发线程数。',
    category: 'kv',
    configSummary: 'bs=4k, rw=randrw, rwmixread=90, numjobs=16, iodepth=64',
    task: {
      name: 'kv-small-4k',
      global: { ...defaultGlobal, runtime: 90 },
      jobs: [
        baseJob({
          name: 'kv-4k-randrw',
          filename: '/data/kv.dat',
          rw: 'randrw',
          bs: '4k',
          size: '16G',
          numjobs: 16,
          iodepth: 64,
          rwmixread: 90,
        }),
      ],
    },
  },

  // -- Logging / append-only workloads --
  {
    id: 'log-append-1m-write',
    name: '日志追加写（1M 顺序写）',
    description:
      '模拟应用 / 中间件写入日志文件或顺序追加型写入，关注顺序写带宽与延迟，使用 1M 大块顺序写。',
    category: 'logging',
    configSummary: 'bs=1m, rw=write, numjobs=4, iodepth=2, direct=1',
    task: {
      name: 'log-append',
      global: { ...defaultGlobal, direct: true, runtime: 120 },
      jobs: [
        baseJob({
          name: 'log-append-1m',
          filename: '/var/log/fio-log.dat',
          rw: 'write',
          bs: '1m',
          size: '64G',
          numjobs: 4,
          iodepth: 2,
        }),
      ],
    },
  },

  // -- Docker / container image & layer storage --
  {
    id: 'docker-layer-128k-randrw',
    name: '容器镜像层（128K 随机读写）',
    description:
      '模拟 Docker / 容器运行时访问镜像层和 overlay 文件系统的 I/O，使用中等块大小的随机读写。',
    category: 'docker',
    configSummary: 'bs=128k, rw=randrw, rwmixread=70, numjobs=8, iodepth=32',
    task: {
      name: 'docker-layer',
      global: { ...defaultGlobal, runtime: 90 },
      jobs: [
        baseJob({
          name: 'docker-layer-128k',
          filename: '/var/lib/docker/fio-layer.dat',
          rw: 'randrw',
          bs: '128k',
          size: '64G',
          numjobs: 8,
          iodepth: 32,
          rwmixread: 70,
        }),
      ],
    },
  },

  // -- CI / build system --
  {
    id: 'ci-build-mixed',
    name: 'CI 构建（混合读写）',
    description:
      '模拟 CI / 构建系统对源码仓库与依赖缓存的 I/O：4K 随机元数据访问 + 1M 顺序读写，大量并行 Job。',
    category: 'ci',
    configSummary: '2 jobs: 4k randrw + 1m seq rw, numjobs=8',
    stonewallBetweenJobs: false,
    task: {
      name: 'ci-build-mixed',
      global: { ...defaultGlobal, runtime: 90 },
      jobs: [
        baseJob({
          name: 'ci-metadata-4k',
          filename: '/build/workspace/ci_meta.dat',
          rw: 'randrw',
          bs: '4k',
          size: '8G',
          numjobs: 8,
          iodepth: 32,
          rwmixread: 80,
        }),
        baseJob({
          name: 'ci-artifact-1m',
          filename: '/build/workspace/ci_artifact.dat',
          rw: 'read',
          bs: '1m',
          size: '64G',
          numjobs: 4,
          iodepth: 8,
        }),
      ],
    },
  },

  // -- AI / ML workloads --
  {
    id: 'ai-train-1m-read',
    name: 'AI 训练数据顺序读（1M）',
    description:
      '模拟深度学习训练从本地盘顺序读取大规模数据集的场景，对连续读吞吐较为敏感。',
    category: 'ai',
    configSummary: 'bs=1m, rw=read, numjobs=8, iodepth=8',
    task: {
      name: 'ai-train-1m',
      global: { ...defaultGlobal, runtime: 180 },
      jobs: [
        baseJob({
          name: 'ai-train-data',
          filename: '/data/ai_train.dat',
          rw: 'read',
          bs: '1m',
          size: '256G',
          numjobs: 8,
          iodepth: 8,
        }),
      ],
    },
  },
  {
    id: 'ai-feature-4k-randread',
    name: 'AI 特征缓存（4K 随机读）',
    description:
      '模拟特征库 / 向量检索缓存等小块随机读场景，适合评估低延迟读能力。',
    category: 'ai',
    configSummary: 'bs=4k, rw=randread, numjobs=16, iodepth=64',
    task: {
      name: 'ai-feature-4k',
      global: { ...defaultGlobal, runtime: 120 },
      jobs: [
        baseJob({
          name: 'ai-feature-randread',
          filename: '/data/ai_feature.dat',
          rw: 'randread',
          bs: '4k',
          size: '32G',
          numjobs: 16,
          iodepth: 64,
        }),
      ],
    },
  },

  // -- Web application --
  {
    id: 'web-frontend-mixed',
    name: 'Web 应用前端静态资源',
    description:
      '模拟 Web 服务访问静态资源（CSS/JS/图片等）的混合负载：顺序读为主，辅以少量随机写。',
    category: 'web',
    configSummary: 'bs=64k, rw=randrw, rwmixread=95, numjobs=4, iodepth=16',
    task: {
      name: 'web-frontend',
      global: { ...defaultGlobal, runtime: 90 },
      jobs: [
        baseJob({
          name: 'web-static',
          filename: '/var/www/static/fio-web.dat',
          rw: 'randrw',
          bs: '64k',
          size: '32G',
          numjobs: 4,
          iodepth: 16,
          rwmixread: 95,
        }),
      ],
    },
  },
  {
    id: 'web-backend-db',
    name: 'Web 后端数据库 I/O',
    description:
      '面向典型 Web 后端（如用户服务、订单服务）的数据库访问模式，偏读 70/30，8K 随机 I/O。',
    category: 'web',
    configSummary: 'bs=8k, rw=randrw, rwmixread=70, numjobs=8, iodepth=32',
    task: {
      name: 'web-backend-db',
      global: { ...defaultGlobal, runtime: 120 },
      jobs: [
        baseJob({
          name: 'web-backend-db-8k',
          filename: '/data/web_backend.db',
          rw: 'randrw',
          bs: '8k',
          size: '32G',
          numjobs: 8,
          iodepth: 32,
          rwmixread: 70,
        }),
      ],
    },
  },
]

