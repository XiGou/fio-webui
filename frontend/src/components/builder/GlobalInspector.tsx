import { Database, Timer, Waves } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { FioOptionValue } from '@/types/api'
import type { FioParameterMap } from '@/types/experiment'

type GlobalInspectorProps = {
  values: FioParameterMap
  onChange: (next: FioParameterMap) => void
}

export function GlobalInspector({ values, onChange }: GlobalInspectorProps) {
  const set = (key: string, value: FioOptionValue) => onChange({ ...values, [key]: value })
  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <div><h3 className="text-xs font-semibold">I/O 引擎</h3><p className="text-[11px] text-muted-foreground">整条流水线的默认执行环境</p></div>
        </div>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="global-ioengine">ioengine</Label>
            <Select value={String(values.ioengine ?? 'io_uring')} onValueChange={(value) => set('ioengine', value)}>
              <SelectTrigger id="global-ioengine"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="io_uring">io_uring</SelectItem>
                <SelectItem value="libaio">libaio</SelectItem>
                <SelectItem value="sync">sync</SelectItem>
                <SelectItem value="psync">psync</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between border border-border px-3 py-2.5">
            <span><Label htmlFor="global-direct">direct I/O</Label><small className="mt-0.5 block text-[10px] text-muted-foreground">绕过页缓存</small></span>
            <Switch id="global-direct" checked={Boolean(values.direct)} onCheckedChange={(checked) => set('direct', checked)} />
          </div>
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <div className="mb-3 flex items-center gap-2">
          <Timer className="h-4 w-4 text-primary" />
          <div><h3 className="text-xs font-semibold">时间与采样</h3><p className="text-[11px] text-muted-foreground">运行时长和实时证据粒度</p></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="global-runtime">runtime (s)</Label><Input id="global-runtime" type="number" min={1} value={String(values.runtime ?? 60)} onChange={(event) => set('runtime', Number(event.target.value) || 1)} /></div>
          <div className="space-y-1.5"><Label htmlFor="global-status">status (s)</Label><Input id="global-status" type="number" min={1} value={String(values.status_interval ?? 1)} onChange={(event) => set('status_interval', Number(event.target.value) || 1)} /></div>
          <div className="space-y-1.5"><Label htmlFor="global-log">log avg (ms)</Label><Input id="global-log" type="number" min={1} value={String(values.log_avg_msec ?? 500)} onChange={(event) => set('log_avg_msec', Number(event.target.value) || 1)} /></div>
          <div className="flex items-end"><label className="flex h-[var(--control-height)] w-full items-center justify-between border border-border px-3 text-xs"><span>time based</span><Switch checked={Boolean(values.time_based)} onCheckedChange={(checked) => set('time_based', checked)} /></label></div>
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <div className="mb-3 flex items-center gap-2">
          <Waves className="h-4 w-4 text-primary" />
          <div><h3 className="text-xs font-semibold">指标来源</h3><p className="text-[11px] text-muted-foreground">当前实现使用 fio stdout/status 流</p></div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-3 border-l-2 border-l-emerald-500 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
          <span><strong className="block">fio status stream</strong><small>IOPS · BW · latency · progress</small></span>
          <span className="h-2 w-2 rounded-full bg-emerald-600" />
        </div>
      </section>
    </div>
  )
}
