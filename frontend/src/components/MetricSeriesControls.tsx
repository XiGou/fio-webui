import { Checkbox } from '@/components/ui/checkbox'
import type { LatencyStatistic, MetricDirection, MetricJobOption } from '@/lib/metricSeries'

type MetricSeriesControlsProps = {
  jobs: MetricJobOption[]
  selectedJobKeys: string[]
  directions: MetricDirection[]
  latencyStatistics: LatencyStatistic[]
  showLatencyStatistics: boolean
  onToggleJob: (key: string) => void
  onToggleDirection: (direction: MetricDirection) => void
  onToggleLatencyStatistic: (statistic: LatencyStatistic) => void
}

function ToggleItem({ checked, label, onCheckedChange }: { checked: boolean; label: string; onCheckedChange: () => void }) {
  return (
    <label className="metric-filter-option">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      <span>{label}</span>
    </label>
  )
}

export function MetricSeriesControls({ jobs, selectedJobKeys, directions, latencyStatistics, showLatencyStatistics, onToggleJob, onToggleDirection, onToggleLatencyStatistic }: MetricSeriesControlsProps) {
  return (
    <div className="metric-series-controls">
      <div className="metric-filter-group">
        <span className="metric-filter-label">Job</span>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {jobs.map((job) => (
            <ToggleItem
              key={job.key}
              checked={selectedJobKeys.includes(job.key)}
              label={job.stageIndex >= 0 ? `OP ${job.stageIndex + 1} · ${job.name}` : job.name}
              onCheckedChange={() => onToggleJob(job.key)}
            />
          ))}
        </div>
      </div>
      <div className="metric-filter-group">
        <span className="metric-filter-label">方向</span>
        <div className="flex gap-1.5">
          <ToggleItem checked={directions.includes('read')} label="读" onCheckedChange={() => onToggleDirection('read')} />
          <ToggleItem checked={directions.includes('write')} label="写" onCheckedChange={() => onToggleDirection('write')} />
        </div>
      </div>
      {showLatencyStatistics ? (
        <div className="metric-filter-group">
          <span className="metric-filter-label">统计</span>
          <div className="flex gap-1.5">
            {(['mean', 'p99', 'max'] as const).map((statistic) => (
              <ToggleItem key={statistic} checked={latencyStatistics.includes(statistic)} label={statistic.toUpperCase()} onCheckedChange={() => onToggleLatencyStatistic(statistic)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
