import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { GitBranch, RefreshCw, AlertCircle, CheckCircle2, Clock, Loader2 } from 'lucide-react'

interface GitHubComponent {
  id: string
  name: string
  status: string
  updated_at: string
  group: boolean
  group_id?: string | null
  only_show_if_degraded: boolean
}

interface ServiceStatus {
  status: {
    indicator: string
    description: string
  }
  components: GitHubComponent[]
}

interface WorkflowRun {
  id: number
  name: string
  status: string
  conclusion?: string | null
  html_url: string
  created_at: string
  updated_at: string
  run_number: number
  actor: { login: string }
  head_branch: string
  head_sha: string
  workflow_id: number
}

interface GitHubActionsStatusResponse {
  service_status?: ServiceStatus
  queued_runs: WorkflowRun[]
  in_progress_runs: WorkflowRun[]
  queued_count: number
  in_progress_count: number
  error?: string
}

function statusIndicatorColor(indicator: string): string {
  switch (indicator) {
    case 'none':
      return 'text-green-600'
    case 'minor':
      return 'text-yellow-600'
    case 'major':
      return 'text-orange-600'
    case 'critical':
      return 'text-red-600'
    default:
      return 'text-muted-foreground'
  }
}

function componentStatusColor(status: string): string {
  switch (status) {
    case 'operational':
      return 'text-green-600'
    case 'degraded_performance':
      return 'text-yellow-500'
    case 'partial_outage':
      return 'text-orange-500'
    case 'major_outage':
      return 'text-red-600'
    default:
      return 'text-muted-foreground'
  }
}

function componentStatusLabel(status: string): string {
  switch (status) {
    case 'operational':
      return '正常'
    case 'degraded_performance':
      return '性能下降'
    case 'partial_outage':
      return '部分中断'
    case 'major_outage':
      return '重大故障'
    default:
      return status
  }
}

function formatRelativeTime(iso: string): string {
  try {
    const now = Date.now()
    const then = new Date(iso).getTime()
    const diffMs = now - then
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffH = Math.floor(diffMin / 60)
    if (diffH < 24) return `${diffH} 小时前`
    return `${Math.floor(diffH / 24)} 天前`
  } catch {
    return iso
  }
}

const ACTIONS_COMPONENTS = [
  'GitHub Actions',
  'Actions',
]

export function GitHubActionsPage() {
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GitHubActionsStatusResponse | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    setResult(null)
    try {
      const params = new URLSearchParams()
      if (owner.trim()) params.set('owner', owner.trim())
      if (repo.trim()) params.set('repo', repo.trim())
      if (token.trim()) params.set('token', token.trim())
      const res = await fetch(`/api/github-actions?${params.toString()}`)
      if (!res.ok) {
        setFetchError(`请求失败：HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as GitHubActionsStatusResponse
      setResult(data)
    } catch (e) {
      setFetchError(`网络错误：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [owner, repo, token])

  const actionsComponents = result?.service_status?.components.filter(
    (c) => !c.group && ACTIONS_COMPONENTS.some((n) => c.name.includes(n))
  ) ?? []

  const overallIndicator = result?.service_status?.status?.indicator ?? ''
  const overallDescription = result?.service_status?.status?.description ?? ''

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          GitHub Actions 队列状态
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          查看 GitHub Actions 服务状态及指定仓库的排队/运行中的工作流，帮助排查 Action 长时间排队的原因
        </p>
      </div>

      {/* 查询表单 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">查询参数</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="owner">仓库所有者（Owner）</Label>
              <Input
                id="owner"
                placeholder="例如：octocat"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="repo">仓库名称（Repo）</Label>
              <Input
                id="repo"
                placeholder="例如：hello-world"
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="token">GitHub Token（可选，用于访问私有仓库）</Label>
            <Input
              id="token"
              type="password"
              placeholder="ghp_xxxx（不填则使用公开 API，有速率限制）"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Token 仅用于本次请求，不会被保存。
            </p>
          </div>
          <Button onClick={fetchStatus} disabled={loading} className="w-full sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                查询中...
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                查询状态
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {fetchError && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {fetchError}
        </div>
      )}

      {result?.error && (
        <div className="rounded border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {result.error}
        </div>
      )}

      {/* GitHub 服务状态 */}
      {result?.service_status && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              {overallIndicator === 'none' ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className={`h-4 w-4 ${statusIndicatorColor(overallIndicator)}`} />
              )}
              GitHub 服务状态
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className={`text-sm font-medium ${statusIndicatorColor(overallIndicator)}`}>
              {overallDescription}
            </div>
            {actionsComponents.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Actions 相关组件
                </div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {actionsComponents.map((c) => (
                    <div key={c.id} className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm text-foreground">{c.name}</span>
                      <span className={`text-xs font-medium ${componentStatusColor(c.status)}`}>
                        {componentStatusLabel(c.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              完整状态请访问{' '}
              <a
                href="https://www.githubstatus.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                githubstatus.com
              </a>
            </p>
          </CardContent>
        </Card>
      )}

      {/* 排队与运行中的工作流 */}
      {result && (owner.trim() || repo.trim()) && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-500" />
                排队中的 Runs
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  共 {result.queued_count} 个
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.queued_count === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">无排队中的 Runs</p>
              ) : (
                <RunList runs={result.queued_runs} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-blue-500" />
                运行中的 Runs
                <span className="ml-auto text-sm font-normal text-muted-foreground">
                  共 {result.in_progress_count} 个
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {result.in_progress_count === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">无运行中的 Runs</p>
              ) : (
                <RunList runs={result.in_progress_runs} />
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* 排查建议 */}
      {result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">排查建议</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
              <li>
                如果 GitHub 服务状态显示异常（非"All Systems Operational"），则排队可能由 GitHub 平台故障引起，需等待官方修复。
              </li>
              <li>
                免费计划（Free）并发 Job 数有限（通常 20 个），如果当前仓库 in_progress runs 较多，新 Job 会排队等待。
              </li>
              <li>
                使用 Self-hosted Runner 时，若 Runner 不在线或标签（label）不匹配，Job 会无限排队。请检查 Runner 状态：
                <code className="mx-1 font-mono bg-muted px-1 rounded">Settings → Actions → Runners</code>。
              </li>
              <li>
                大型公有仓库可能存在公共 Runner 资源紧张问题，可考虑升级 GitHub 计划或使用 Self-hosted Runner。
              </li>
              <li>
                可在{' '}
                <a
                  href="https://www.githubstatus.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  githubstatus.com
                </a>{' '}
                订阅状态通知，第一时间了解服务故障。
              </li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function RunList({ runs }: { runs: WorkflowRun[] }) {
  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {runs.map((run) => (
        <a
          key={run.id}
          href={run.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded border border-border p-2.5 text-xs hover:border-primary/50 hover:bg-muted/50 transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-foreground truncate">{run.name || `Run #${run.run_number}`}</span>
            <span className="shrink-0 text-muted-foreground">#{run.run_number}</span>
          </div>
          <div className="mt-1 text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
            <span>分支：{run.head_branch}</span>
            <span>触发者：{run.actor?.login}</span>
            <span>创建：{formatRelativeTime(run.created_at)}</span>
          </div>
        </a>
      ))}
    </div>
  )
}
