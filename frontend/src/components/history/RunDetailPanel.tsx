import { Activity, Copy, FileDown, Play, RotateCcw, Save, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MetricSeriesControls } from '@/components/MetricSeriesControls'
import { getReportMetricJobs, type LatencyStatistic, type MetricDirection } from '@/lib/metricSeries'
import { formatMetricValue } from '@/lib/statsFormat'
import type { FioTaskList, RunReportDTO } from '@/types/api'
import { ReportMetricChart } from './ReportMetricChart'
import type { HistoryAction, RunDetail } from './types'

type RunDetailPanelProps = {
  detail: RunDetail | null
  report: RunReportDTO | null
  loading: boolean
  detailError: string
  onAction: (action: HistoryAction) => void
  statusColor: (status: string) => string
  formatBytes: (bytes: number) => string
}

function hasConfig(config: FioTaskList | null): boolean {
  return Boolean(config?.tasks?.length)
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return minutes > 0 ? `${minutes}m ${String(remainder).padStart(2, '0')}s` : `${remainder}s`
}

function sourceLabel(report: RunReportDTO): string {
  if (report.source.kind === 'fio-task-logs') {
    return report.source.latency_mode.startsWith('histogram') ? 'fio task logs · clat histogram' : 'fio task logs · window fallback'
  }
  return 'stats.jsonl · compatibility fallback'
}

function DirectionBreakdown({ type, read, write }: { type: 'iops' | 'bw' | 'lat'; read: number; write: number }) {
  return (
    <small className="mt-1 block font-mono text-[9px] leading-4 text-muted-foreground">
      <span className="block whitespace-nowrap">R {formatMetricValue(type, read)}</span>
      <span className="block whitespace-nowrap">W {formatMetricValue(type, write)}</span>
    </small>
  )
}

export function RunDetailPanel({ detail, report, loading, detailError, onAction, statusColor, formatBytes }: RunDetailPanelProps) {
  const [domainState, setDomainState] = useState<{ runId: string; domain: { min: number; max: number } | null }>({ runId: '', domain: null })
  const [jobSelection, setJobSelection] = useState<{ runId: string; keys: string[] }>({ runId: '', keys: [] })
  const [directions, setDirections] = useState<MetricDirection[]>(['read', 'write'])
  const [latencyStatistics, setLatencyStatistics] = useState<LatencyStatistic[]>(['mean', 'p99', 'max'])
  const summary = report?.summary
  const stages = report?.stages ?? []
  const series = report?.series ?? []
  const jobSeries = useMemo(() => report?.job_series ?? [], [report?.job_series])
  const metricJobs = useMemo(() => getReportMetricJobs(jobSeries), [jobSeries])
  const runId = report?.meta.id ?? ''
  const defaultJobKeys = useMemo(() => metricJobs.map((job) => job.key), [metricJobs])
  const selectedJobKeys = jobSelection.runId === runId ? jobSelection.keys.filter((key) => defaultJobKeys.includes(key)) : defaultJobKeys
  const xDomain = domainState.runId === runId ? domainState.domain : null
  const totalStageDuration = Math.max(1, stages.at(-1)?.end_seconds ?? summary?.duration_seconds ?? 1)

  const syncDomain = useCallback((domain: { min: number; max: number }) => {
    setDomainState((current) => current.runId === runId && current.domain && Math.abs(current.domain.min - domain.min) < 0.001 && Math.abs(current.domain.max - domain.max) < 0.001 ? current : { runId, domain })
  }, [runId])

  const toggleJob = (key: string) => setJobSelection(() => ({
    runId,
    keys: selectedJobKeys.includes(key)
      ? selectedJobKeys.length > 1 ? selectedJobKeys.filter((item) => item !== key) : selectedJobKeys
      : [...selectedJobKeys, key],
  }))
  const toggleDirection = (direction: MetricDirection) => setDirections((current) => current.includes(direction)
    ? current.length > 1 ? current.filter((item) => item !== direction) : current
    : [...current, direction])
  const toggleLatencyStatistic = (statistic: LatencyStatistic) => setLatencyStatistics((current) => current.includes(statistic)
    ? current.length > 1 ? current.filter((item) => item !== statistic) : current
    : [...current, statistic])

  return (
    <section className="h-full min-h-0 bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 lg:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">性能报告</h2>
            {detail ? <Badge tone={detail.meta.status === 'finished' ? 'success' : detail.meta.status === 'error' ? 'danger' : 'info'}>{detail.meta.status}</Badge> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{detail?.meta.id ?? 'SELECT A RUN'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => onAction('open-monitor')} disabled={!detail}><Activity />监控</Button>
          <Button size="sm" variant="ghost" onClick={() => onAction('restore-workflow')} disabled={!hasConfig(detail?.config ?? null)}><Play />恢复</Button>
          <Button size="sm" variant="ghost" onClick={() => onAction('duplicate')} disabled={!hasConfig(detail?.config ?? null)}><Copy />复制</Button>
          <Button size="sm" variant="ghost" onClick={() => onAction('save-template')} disabled={!hasConfig(detail?.config ?? null)}><Save />模板</Button>
          <Button size="sm" variant="outline" onClick={() => onAction('export-report')} disabled={!report}><FileDown />导出 HTML</Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-destructive" title="删除运行" aria-label="删除运行" onClick={() => onAction('delete')} disabled={!detail}><Trash2 /></Button>
        </div>
      </header>

      <div className="max-h-[calc(100vh-8.6rem)] overflow-auto">
        {detailError ? <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{detailError}</div> : null}
        {!detail ? <div className="flex min-h-80 items-center justify-center p-8 text-sm text-muted-foreground">从运行索引中选择一条记录生成报告。</div> : loading ? (
          <div className="space-y-4 p-5" aria-label="正在生成报告">
            <div className="h-16 animate-pulse bg-muted" />
            <div className="h-28 animate-pulse bg-muted" />
            <div className="h-64 animate-pulse bg-muted" />
          </div>
        ) : report ? (
          <>
            <section className="grid border-b border-border md:grid-cols-[1.2fr_1fr_1fr]">
              <div className="p-4 md:border-r md:border-border">
                <p className="text-[10px] font-semibold text-muted-foreground">数据来源</p>
                <p className="mt-1 text-xs font-medium">{sourceLabel(report)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{report.source.files.length} files · {report.source.sample_interval_ms ?? '-'} ms sample window</p>
              </div>
              <div className="border-t border-border p-4 md:border-r md:border-t-0">
                <p className="text-[10px] font-semibold text-muted-foreground">运行窗口</p>
                <p className="mt-1 font-mono text-xs">{formatDuration(summary?.duration_seconds ?? 0)} · {summary?.sample_count ?? 0} samples</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{stages.length} 节点 · {formatBytes(detail.meta.disk_bytes)}</p>
              </div>
              <div className="border-t border-border p-4 md:border-t-0">
                <p className="text-[10px] font-semibold text-muted-foreground">记录状态</p>
                <p className={`mt-1 text-xs font-medium ${statusColor(detail.meta.status)}`}>{detail.meta.status}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{detail.meta.start_time || '-'} → {detail.meta.end_time || '-'}</p>
              </div>
            </section>

            <section className="grid border-b border-border sm:grid-cols-3">
              <div className="p-4 sm:border-r sm:border-border">
                <h3 className="text-xs font-semibold">IOPS</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div><dt className="text-[10px] text-muted-foreground">MEAN</dt><dd className="mt-1 font-mono text-lg font-semibold">{formatMetricValue('iops', summary?.mean_iops ?? 0)}</dd><DirectionBreakdown type="iops" read={summary?.mean_iops_read ?? 0} write={summary?.mean_iops_write ?? 0} /></div>
                  <div><dt className="text-[10px] text-muted-foreground">MAX</dt><dd className="mt-1 font-mono text-lg font-semibold">{formatMetricValue('iops', summary?.peak_iops ?? 0)}</dd><DirectionBreakdown type="iops" read={summary?.peak_iops_read ?? 0} write={summary?.peak_iops_write ?? 0} /></div>
                </dl>
              </div>
              <div className="border-t border-border p-4 sm:border-r sm:border-t-0">
                <h3 className="text-xs font-semibold">带宽</h3>
                <dl className="mt-3 grid grid-cols-2 gap-3">
                  <div><dt className="text-[10px] text-muted-foreground">MEAN</dt><dd className="mt-1 font-mono text-lg font-semibold">{formatMetricValue('bw', summary?.mean_bandwidth_mib ?? 0)}</dd><DirectionBreakdown type="bw" read={summary?.mean_bandwidth_read_mib ?? 0} write={summary?.mean_bandwidth_write_mib ?? 0} /></div>
                  <div><dt className="text-[10px] text-muted-foreground">MAX</dt><dd className="mt-1 font-mono text-lg font-semibold">{formatMetricValue('bw', summary?.peak_bandwidth_mib ?? 0)}</dd><DirectionBreakdown type="bw" read={summary?.peak_bandwidth_read_mib ?? 0} write={summary?.peak_bandwidth_write_mib ?? 0} /></div>
                </dl>
              </div>
              <div className="border-t border-border p-4 sm:border-t-0">
                <h3 className="text-xs font-semibold">完成延迟</h3>
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  <div><dt className="text-[10px] text-muted-foreground">MEAN</dt><dd className="mt-1 font-mono text-sm font-semibold">{formatMetricValue('lat', summary?.mean_latency_ms ?? 0)}</dd><DirectionBreakdown type="lat" read={summary?.mean_latency_read_ms ?? 0} write={summary?.mean_latency_write_ms ?? 0} /></div>
                  <div><dt className="text-[10px] text-muted-foreground">P99</dt><dd className="mt-1 font-mono text-sm font-semibold text-amber-700">{formatMetricValue('lat', summary?.p99_latency_ms ?? 0)}</dd><DirectionBreakdown type="lat" read={summary?.p99_latency_read_ms ?? 0} write={summary?.p99_latency_write_ms ?? 0} /></div>
                  <div><dt className="text-[10px] text-muted-foreground">MAX</dt><dd className="mt-1 font-mono text-sm font-semibold text-red-700">{formatMetricValue('lat', summary?.peak_latency_ms ?? 0)}</dd><DirectionBreakdown type="lat" read={summary?.peak_latency_read_ms ?? 0} write={summary?.peak_latency_write_ms ?? 0} /></div>
                </dl>
              </div>
            </section>

            {jobSeries.length ? (
              <section className="border-b border-border">
                <header className="border-b border-border px-4 py-3"><h3 className="text-xs font-semibold">Job 性能明细</h3></header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-[10px]">
                    <thead className="bg-muted/50 text-muted-foreground"><tr><th className="px-3 py-2 font-semibold">Job</th><th className="px-3 py-2 font-semibold">IOPS MEAN R / W</th><th className="px-3 py-2 font-semibold">IOPS MAX R / W</th><th className="px-3 py-2 font-semibold">BW MEAN R / W</th><th className="px-3 py-2 font-semibold">P99 LAT R / W</th></tr></thead>
                    <tbody className="divide-y divide-border">
                      {jobSeries.map((job) => <tr key={job.key}><td className="px-3 py-2"><strong className="block text-xs">{job.name}</strong><span className="text-muted-foreground">OP {job.stage_index + 1} · {job.stage_name}</span></td><td className="px-3 py-2 font-mono">{formatMetricValue('iops', job.summary.mean_iops_read)} / {formatMetricValue('iops', job.summary.mean_iops_write)}</td><td className="px-3 py-2 font-mono">{formatMetricValue('iops', job.summary.peak_iops_read)} / {formatMetricValue('iops', job.summary.peak_iops_write)}</td><td className="px-3 py-2 font-mono">{formatMetricValue('bw', job.summary.mean_bandwidth_read_mib)} / {formatMetricValue('bw', job.summary.mean_bandwidth_write_mib)}</td><td className="px-3 py-2 font-mono">{formatMetricValue('lat', job.summary.p99_latency_read_ms)} / {formatMetricValue('lat', job.summary.p99_latency_write_ms)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className="border-b border-border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h3 className="text-xs font-semibold">节点时间带</h3><p className="mt-0.5 text-[11px] text-muted-foreground">竖线标记每个节点在 fio task 日志时间轴上的起点。</p></div>
                <Button size="sm" variant="ghost" onClick={() => setDomainState({ runId, domain: null })}><RotateCcw />重置缩放</Button>
              </div>
              <div className="overflow-x-auto border border-border bg-workbench">
                <div className="flex min-w-[520px]">
                  {stages.map((stage) => (
                    <div
                      key={`${stage.index}-${stage.start_seconds}`}
                      className="min-w-28 border-r border-border px-3 py-2 last:border-r-0"
                      style={{ flexGrow: Math.max(0.05, (stage.end_seconds - stage.start_seconds) / totalStageDuration) }}
                    >
                      <span className="font-mono text-[9px] text-muted-foreground">OP {String(stage.index + 1).padStart(2, '0')} · {stage.start_seconds.toFixed(1)}s</span>
                      <strong className="mt-0.5 block truncate text-xs">{stage.name}</strong>
                      <small className="text-[10px] text-muted-foreground">{stage.job_count} Job · {formatDuration(stage.end_seconds - stage.start_seconds)}</small>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="space-y-4 bg-workbench p-4">
              <MetricSeriesControls jobs={metricJobs} selectedJobKeys={selectedJobKeys} directions={directions} latencyStatistics={latencyStatistics} showLatencyStatistics onToggleJob={toggleJob} onToggleDirection={toggleDirection} onToggleLatencyStatistic={toggleLatencyStatistic} />
              {([
                ['iops', 'IOPS', `MEAN ${formatMetricValue('iops', summary?.mean_iops ?? 0)} · MAX ${formatMetricValue('iops', summary?.peak_iops ?? 0)}`],
                ['bw', '带宽', `MEAN ${formatMetricValue('bw', summary?.mean_bandwidth_mib ?? 0)} · MAX ${formatMetricValue('bw', summary?.peak_bandwidth_mib ?? 0)}`],
                ['lat', '完成延迟', `MEAN ${formatMetricValue('lat', summary?.mean_latency_ms ?? 0)} · P99 ${formatMetricValue('lat', summary?.p99_latency_ms ?? 0)} · MAX ${formatMetricValue('lat', summary?.peak_latency_ms ?? 0)}`],
              ] as const).map(([type, title, stats]) => (
                <section key={type} className="border border-border bg-background">
                  <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <h3 className="text-xs font-semibold">{title}</h3>
                    <span className="font-mono text-[10px] text-muted-foreground">{stats}</span>
                  </header>
                  <div className="p-2">
                    <ReportMetricChart data={series} stages={stages} type={type} height={250} xDomain={xDomain} onDomainChange={syncDomain} jobSeries={jobSeries} jobs={metricJobs} selectedJobKeys={selectedJobKeys} directions={directions} latencyStatistics={latencyStatistics} />
                  </div>
                </section>
              ))}
            </div>

            <section className="border-t border-border">
              <details className="border-b border-border px-4 py-3">
                <summary className="cursor-pointer text-xs font-semibold">日志来源与错误</summary>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div className="border border-border p-3"><p className="mb-2 text-[10px] font-semibold text-muted-foreground">FIO LOG FILES</p><div className="flex flex-wrap gap-1">{report.source.files.map((file) => <Badge key={file}>{file}</Badge>)}</div></div>
                  <div className="border border-border p-3"><p className="mb-2 text-[10px] font-semibold text-muted-foreground">RUN ERRORS</p>{report.errors.length ? <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs text-destructive">{report.errors.join('\n')}</pre> : <p className="text-xs text-muted-foreground">未记录到运行错误。</p>}</div>
                </div>
              </details>
              <details className="px-4 py-3">
                <summary className="cursor-pointer text-xs font-semibold">可复现配置</summary>
                <pre className="mt-3 max-h-96 overflow-auto border border-border bg-muted/40 p-3 text-xs">{JSON.stringify(report.config, null, 2)}</pre>
              </details>
            </section>
          </>
        ) : <div className="p-6 text-sm text-muted-foreground">该运行没有可生成报告的数据。</div>}
      </div>
    </section>
  )
}
