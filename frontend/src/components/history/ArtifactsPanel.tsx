import { FileText, Files, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LogSummary } from '@/types/api'
import type { RunDetail } from './types'

type ArtifactsPanelProps = {
  detail: RunDetail | null
  logSummary: LogSummary | null
  detailError: string
  onFetchLogSummary: () => void
  onExportReport: () => void
}

export function ArtifactsPanel({ detail, logSummary, detailError, onFetchLogSummary, onExportReport }: ArtifactsPanelProps) {
  return (
    <section className="h-full bg-background p-4 lg:p-5">
      <header className="mb-4"><h2 className="text-xs font-semibold">报告产物</h2><p className="text-[10px] uppercase text-muted-foreground">Artifacts</p></header>
      <div className="max-h-[calc(100vh-9rem)] space-y-3 overflow-auto text-sm">
        {!detail ? <p className="text-muted-foreground">选择一个运行后查看报告、日志与原始数据。</p> : (
          <>
            {detailError ? <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onExportReport}><FileText className="h-4 w-4 mr-1" />导出报告</Button>
              <Button size="sm" variant="outline" onClick={onFetchLogSummary}><ScrollText className="h-4 w-4 mr-1" />加载日志摘要</Button>
            </div>
            {logSummary && (
              <div className="border border-border p-3">
                <p className="text-xs font-medium mb-2">日志摘要</p>
                {logSummary.summary ? <pre className="text-xs bg-muted/50 p-2 overflow-auto whitespace-pre-wrap max-h-40">{logSummary.summary}</pre> : <p className="text-xs text-muted-foreground">暂无摘要</p>}
                {logSummary.errors?.length ? <pre className="text-xs bg-destructive/10 p-2 overflow-auto whitespace-pre-wrap text-destructive mt-2 max-h-40">{logSummary.errors.join('\n')}</pre> : null}
                {!logSummary.summary && !logSummary.errors?.length ? <p className="mt-2 text-xs text-muted-foreground">这次运行没有保存到可解析的 stdout/stderr 日志。</p> : null}
              </div>
            )}
            <div className="border border-border p-3">
              <p className="text-xs font-medium mb-2">原始配置 JSON</p>
              <pre className="text-xs bg-muted/50 p-2 overflow-auto max-h-80"><Files className="inline h-3 w-3 mr-1" />{JSON.stringify(detail.config, null, 2)}</pre>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
