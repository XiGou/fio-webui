import { FileText, Files, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LogSummary } from '@/types/api'
import type { RunDetail } from './types'

type ArtifactsPanelProps = {
  detail: RunDetail | null
  logSummary: LogSummary | null
  onFetchLogSummary: () => void
  onExportReport: () => void
}

export function ArtifactsPanel({ detail, logSummary, onFetchLogSummary, onExportReport }: ArtifactsPanelProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">ArtifactsPanel</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm max-h-[72vh] overflow-auto">
        {!detail ? <p className="text-muted-foreground">选择一个运行后查看报告、日志与原始数据。</p> : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={onExportReport}><FileText className="h-4 w-4 mr-1" />导出报告</Button>
              <Button size="sm" variant="outline" onClick={onFetchLogSummary}><ScrollText className="h-4 w-4 mr-1" />加载日志摘要</Button>
            </div>
            {logSummary && (
              <div className="rounded border border-border p-3">
                <p className="text-xs font-medium mb-2">日志摘要</p>
                {logSummary.summary ? <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto whitespace-pre-wrap max-h-40">{logSummary.summary}</pre> : <p className="text-xs text-muted-foreground">暂无摘要</p>}
                {logSummary.errors?.length ? <pre className="text-xs bg-destructive/10 p-2 rounded overflow-auto whitespace-pre-wrap text-destructive mt-2 max-h-40">{logSummary.errors.join('\n')}</pre> : null}
              </div>
            )}
            <div className="rounded border border-border p-3">
              <p className="text-xs font-medium mb-2">原始配置 JSON</p>
              <pre className="text-xs bg-muted/50 p-2 rounded overflow-auto max-h-80"><Files className="inline h-3 w-3 mr-1" />{JSON.stringify(detail.config, null, 2)}</pre>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
