import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Canvas } from '@/components/workflow/Canvas'
import fioParameters from '@/data/fio-parameters.json'
import type { WorkflowCanvasEdge } from '@/components/workflow/EdgeRenderer'
import type { WorkflowCanvasNode, WorkflowNodeKind } from '@/components/workflow/NodeRenderer'
import type { FioTask, FioTaskList, GlobalConfig, JobConfig, RunState } from '@/types/api'

const VERSION_ITEMS = ['草稿工作流', '模板库', '已发布工作流']

type ValidationResult = {
  errors: string[]
  invalidNodeIds: Set<string>
  invalidEdgeIds: Set<string>
}

type CompileError = { nodeId?: string; message: string }
type CompileResult = {
  workflowId: string
  workflowVersion: number
  compiledAt: string
  taskList: FioTaskList
  errors: CompileError[]
}

type ParamType = 'text' | 'number' | 'boolean' | 'select'
type FioParamField = { key: string; label: string; type: ParamType; options?: string[]; placeholder?: string }
type FioParamGroup = { id: string; title: string; collapsedByDefault: boolean; fields: FioParamField[] }

type NodePreset = {
  id: string
  name: string
  description: string
  kind: WorkflowNodeKind
  category: '自定义' | '预设'
  defaults?: Record<string, string | number | boolean>
}

const FIO_GROUPS = fioParameters.groups as FioParamGroup[]

const NODE_PRESETS: NodePreset[] = [
  { id: 'custom-start', name: 'StartNode', description: '工作流起点', kind: 'start', category: '自定义' },
  { id: 'custom-end', name: 'EndNode', description: '工作流终点', kind: 'end', category: '自定义' },
  {
    id: 'custom-fio',
    name: 'FioJobNode',
    description: '可自定义 fio job 参数',
    kind: 'fioJob',
    category: '自定义',
    defaults: { rw: 'read', bs: '4k', iodepth: 1 },
  },
  {
    id: 'custom-barrier',
    name: 'BarrierNode',
    description: 'stonewall / 阶段切换',
    kind: 'barrier',
    category: '自定义',
    defaults: { stonewall: true, phase: 'phase-1' },
  },
  {
    id: 'preset-seq-read',
    name: '顺序读 128k',
    description: '常用预设：吞吐型顺序读',
    kind: 'fioJob',
    category: '预设',
    defaults: { label: '顺序读 128k', rw: 'read', bs: '128k', iodepth: 32, numjobs: 1, ioengine: 'io_uring', direct: true },
  },
  {
    id: 'preset-rand-read',
    name: '随机读 4k',
    description: '常用预设：低延迟随机读',
    kind: 'fioJob',
    category: '预设',
    defaults: { label: '随机读 4k', rw: 'randread', bs: '4k', iodepth: 64, numjobs: 4, ioengine: 'io_uring', direct: true },
  },
  {
    id: 'preset-rand-write',
    name: '随机写 4k',
    description: '常用预设：随机写压测',
    kind: 'fioJob',
    category: '预设',
    defaults: { label: '随机写 4k', rw: 'randwrite', bs: '4k', iodepth: 32, numjobs: 4, ioengine: 'io_uring', direct: true },
  },
  {
    id: 'preset-mix',
    name: '70/30 混合读写',
    description: '常用预设：数据库类混合负载',
    kind: 'fioJob',
    category: '预设',
    defaults: { label: '混合读写 70/30', rw: 'randrw', rwmixread: 70, bs: '8k', iodepth: 32, numjobs: 2, ioengine: 'io_uring', direct: true },
  },
]

const nextId = (prefix: string) => {
  const uid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${uid}`
}

const createNode = (preset: NodePreset, index: number): WorkflowCanvasNode => ({
  id: nextId(preset.kind),
  type: preset.kind,
  position: { x: 80 + index * 42, y: 80 + index * 34 },
  data: {
    label: `${preset.name}-${index + 1}`,
    ...(preset.defaults ?? {}),
  },
})

const isConnectionLegal = (source: WorkflowCanvasNode | undefined, target: WorkflowCanvasNode | undefined) => {
  if (!source || !target) return false
  if (source.id === target.id) return false
  if (source.type === 'end') return false
  if (target.type === 'start') return false
  return true
}

const validateTopology = (nodes: WorkflowCanvasNode[], edges: WorkflowCanvasEdge[]): ValidationResult => {
  const errors: string[] = []
  const invalidNodeIds = new Set<string>()
  const invalidEdgeIds = new Set<string>()
  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    outDegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }

  const unique = new Set<string>()
  for (const edge of edges) {
    const key = `${edge.source}->${edge.target}`
    if (unique.has(key)) {
      invalidEdgeIds.add(edge.id)
      errors.push(`存在重复连线 ${key}。`)
      continue
    }
    unique.add(key)

    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (!isConnectionLegal(source, target)) {
      invalidEdgeIds.add(edge.id)
      if (source) invalidNodeIds.add(source.id)
      if (target) invalidNodeIds.add(target.id)
      errors.push(`非法连接 ${edge.source} -> ${edge.target}。`)
      continue
    }

    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1)
  }

  const starts = nodes.filter((node) => node.type === 'start')
  const ends = nodes.filter((node) => node.type === 'end')

  if (starts.length !== 1) {
    errors.push('拓扑必须且仅有一个 StartNode。')
    starts.forEach((node) => invalidNodeIds.add(node.id))
  }
  if (ends.length !== 1) {
    errors.push('拓扑必须且仅有一个 EndNode。')
    ends.forEach((node) => invalidNodeIds.add(node.id))
  }

  nodes.forEach((node) => {
    const inCount = inDegree.get(node.id) ?? 0
    const outCount = outDegree.get(node.id) ?? 0
    if (node.type === 'start' && inCount > 0) {
      errors.push(`StartNode ${node.id} 不能有入边。`)
      invalidNodeIds.add(node.id)
    }
    if (node.type === 'end' && outCount > 0) {
      errors.push(`EndNode ${node.id} 不能有出边。`)
      invalidNodeIds.add(node.id)
    }
    if (inCount === 0 && outCount === 0) {
      errors.push(`节点 ${node.id} 孤立未连接。`)
      invalidNodeIds.add(node.id)
    }
  })

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dfs = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      invalidNodeIds.add(nodeId)
      errors.push(`发现环路，重复访问节点 ${nodeId}。`)
      return
    }
    if (visited.has(nodeId)) return
    visiting.add(nodeId)
    for (const nextId of adjacency.get(nodeId) ?? []) dfs(nextId)
    visiting.delete(nodeId)
    visited.add(nodeId)
  }
  nodes.forEach((node) => dfs(node.id))

  return { errors: Array.from(new Set(errors)), invalidNodeIds, invalidEdgeIds }
}


const DEFAULT_GLOBAL: GlobalConfig = {
  ioengine: 'libaio',
  direct: true,
  runtime: 60,
  time_based: true,
  group_reporting: true,
  log_avg_msec: 500,
  output_format: 'json',
  status_interval: 1,
}

const buildCompiledTaskList = (nodes: WorkflowCanvasNode[], edges: WorkflowCanvasEdge[]): CompileResult => {
  const compiledAt = new Date().toISOString()
  const workflowId = `wf-${Date.now().toString(36)}`
  const errors: CompileError[] = []
  const taskList: FioTaskList = { tasks: [] }
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  for (const node of nodes) {
    indegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue
    adjacency.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }
  const queue = nodes.filter((n) => (indegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) break
    order.push(id)
    for (const nextId of adjacency.get(id) ?? []) {
      const next = (indegree.get(nextId) ?? 1) - 1
      indegree.set(nextId, next)
      if (next === 0) queue.push(nextId)
    }
  }
  const sortedNodes = order.length === nodes.length ? order.map((id) => nodeById.get(id)!).filter(Boolean) : nodes
  let currentTask: FioTask | null = null
  const flush = () => { if (currentTask && currentTask.jobs.length > 0) taskList.tasks.push(currentTask); currentTask = null }
  for (const node of sortedNodes) {
    if (node.type === 'start' || node.type === 'end') continue
    if (node.type === 'barrier') {
      if (!currentTask || currentTask.jobs.length === 0) {
        errors.push({ nodeId: node.id, message: 'Barrier 节点前缺少 job。' })
        continue
      }
      currentTask.jobs[currentTask.jobs.length - 1] = { ...currentTask.jobs[currentTask.jobs.length - 1], stonewallAfter: true }
      flush()
      continue
    }
    const filename = String(node.data.filename ?? '/tmp/fio-test').trim()
    if (!filename) errors.push({ nodeId: node.id, message: 'filename 不能为空。' })
    const rw = String(node.data.rw ?? 'read').trim()
    const bs = String(node.data.bs ?? '4k').trim()
    const size = String(node.data.size ?? '1G').trim()
    const job: JobConfig = {
      name: String(node.data.label ?? node.id), filename: filename || '/tmp/fio-test', rw, bs, size,
      numjobs: Number(node.data.numjobs ?? 1), iodepth: Number(node.data.iodepth ?? 1),
      rwmixread: Number(node.data.rwmixread ?? 70), rate: String(node.data.rate ?? ''), runtime: Number(node.data.runtime ?? 0),
      ioengine: String(node.data.ioengine ?? ''), nodeId: node.id,
    }
    if (!currentTask) {
      currentTask = { name: String(node.data.taskName ?? `task-${taskList.tasks.length + 1}`), global: { ...DEFAULT_GLOBAL }, jobs: [] }
    }
    currentTask.jobs.push(job)
  }
  flush()
  if (taskList.tasks.length === 0) errors.push({ message: '编译后无可执行任务。' })
  return { workflowId, workflowVersion: 1, compiledAt, taskList, errors }
}

export function WorkflowStudioPage() {
  const [activeVersion, setActiveVersion] = useState(VERSION_ITEMS[0])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [propertyOpen, setPropertyOpen] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [nodes, setNodes] = useState<WorkflowCanvasNode[]>([
    { id: 'start-1', type: 'start', position: { x: 80, y: 120 }, data: { label: '开始' } },
    { id: 'fio-1', type: 'fioJob', position: { x: 360, y: 120 }, data: { label: '顺序读', rw: 'read', bs: '128k', iodepth: 1 } },
    { id: 'end-1', type: 'end', position: { x: 650, y: 120 }, data: { label: '结束' } },
  ])
  const [edges, setEdges] = useState<WorkflowCanvasEdge[]>([
    { id: 'edge-1', source: 'start-1', target: 'fio-1' },
    { id: 'edge-2', source: 'fio-1', target: 'end-1' },
  ])
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [validation, setValidation] = useState<ValidationResult>({ errors: [], invalidNodeIds: new Set(), invalidEdgeIds: new Set() })
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(FIO_GROUPS.map((group) => [group.id, group.collapsedByDefault]))
  )
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null)
  const [runError, setRunError] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b') setLibraryOpen((value) => !value)
      if (event.key.toLowerCase() === 'p') setPropertyOpen((value) => !value)
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedNodeSet = new Set(selectedNodeIds)
        if (selectedNodeSet.size > 0) {
          setNodes((previous) => previous.filter((node) => !selectedNodeSet.has(node.id)))
          setEdges((previous) => previous.filter((edge) => !selectedNodeSet.has(edge.source) && !selectedNodeSet.has(edge.target)))
          setSelectedNodeIds([])
          setSelectedEdgeIds([])
          setCompileResult(null)
          return
        }
        if (selectedEdgeIds.length > 0) {
          setEdges((previous) => previous.filter((edge) => !selectedEdgeIds.includes(edge.id)))
          setSelectedEdgeIds([])
          setCompileResult(null)
        }
      }
      if (event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setValidation(validateTopology(nodes, edges))
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [nodes, edges, selectedNodeIds, selectedEdgeIds])

  const selectedNode = useMemo(
    () => nodes.find((node) => selectedNodeIds.length === 1 && node.id === selectedNodeIds[0]),
    [nodes, selectedNodeIds]
  )

  const visiblePresets = useMemo(() => {
    const keyword = librarySearch.trim().toLowerCase()
    if (!keyword) return NODE_PRESETS
    return NODE_PRESETS.filter((preset) => `${preset.name} ${preset.description} ${preset.category}`.toLowerCase().includes(keyword))
  }, [librarySearch])

  const updateSelectedNodeData = (field: string, value: string | number | boolean) => {
    if (!selectedNode) return
    setNodes((previous) => previous.map((node) => (node.id === selectedNode.id ? { ...node, data: { ...node.data, [field]: value } } : node)))
  }

  const canConnect = (sourceId: string, targetId: string) => {
    const source = nodes.find((node) => node.id === sourceId)
    const target = nodes.find((node) => node.id === targetId)
    if (!isConnectionLegal(source, target)) {
      return false
    }
    return !edges.some((edge) => edge.source === sourceId && edge.target === targetId)
  }

  const compileWorkflow = () => {
    const topo = validateTopology(nodes, edges)
    const compiled = buildCompiledTaskList(nodes, edges)
    const invalidNodeIds = new Set([...topo.invalidNodeIds, ...compiled.errors.filter((e) => e.nodeId).map((e) => e.nodeId as string)])
    setValidation({ ...topo, invalidNodeIds, errors: [...topo.errors, ...compiled.errors.map((e) => e.message)] })
    setCompileResult(compiled.errors.length === 0 && topo.errors.length === 0 ? compiled : null)
  }

  const runCompiledWorkflow = async () => {
    if (!compileResult) return
    setIsRunning(true)
    setRunError('')
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tasks: compileResult.taskList.tasks, workflow_id: compileResult.workflowId, workflow_version: compileResult.workflowVersion, compiled_at: compileResult.compiledAt }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      setRunError(err.error ?? res.statusText)
      setIsRunning(false)
      return
    }
    const runState = await res.json().catch(() => null) as RunState | null
    setIsRunning(false)
    navigate(`/monitor${runState?.id ? `?runId=${runState.id}` : ''}`)
  }

  const renderFioField = (field: FioParamField) => {
    const value = selectedNode?.data[field.key]

    if (field.type === 'boolean') {
      return (
        <label key={field.key} className="flex items-center justify-between gap-3 rounded border border-border px-2 py-1 text-xs">
          <span>{field.label}</span>
          <input type="checkbox" checked={Boolean(value)} onChange={(event) => updateSelectedNodeData(field.key, event.target.checked)} />
        </label>
      )
    }

    if (field.type === 'select') {
      return (
        <label key={field.key} className="space-y-1 text-xs">
          <span className="text-muted-foreground">{field.label}</span>
          <select className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs" value={String(value ?? '')} onChange={(event) => updateSelectedNodeData(field.key, event.target.value)}>
            <option value="">未设置</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      )
    }

    return (
      <label key={field.key} className="space-y-1 text-xs">
        <span className="text-muted-foreground">{field.label}</span>
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(event) => updateSelectedNodeData(field.key, field.type === 'number' ? Number(event.target.value || 0) : event.target.value)}
        />
      </label>
    )
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <div>
            <CardTitle className="text-base font-medium">工作流工作台</CardTitle>
            <p className="text-xs text-muted-foreground">B: 节点库开关 · P: 属性面板开关 · Del/Backspace: 删除选中节点或边 · Ctrl/Cmd+V: 运行拓扑校验</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-md border border-border bg-background p-1">
              {VERSION_ITEMS.map((item) => (
                <Button key={item} size="sm" variant={item === activeVersion ? 'default' : 'ghost'} className="h-7 px-2 text-xs" onClick={() => setActiveVersion(item)}>
                  {item}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => setLibraryOpen((v) => !v)}>{libraryOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} 节点库</Button>
            <Button size="sm" variant="outline" onClick={() => setPropertyOpen((v) => !v)}>{propertyOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />} 属性</Button>
            <Button size="sm" variant="outline" onClick={compileWorkflow}>编译并预览</Button>
            <Button size="sm" onClick={runCompiledWorkflow} disabled={!compileResult || isRunning}>执行编译结果</Button>
            <Button size="sm" variant="outline" onClick={() => navigate('/monitor')}>实时状态全屏</Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={selectedNodeIds.length === 0 && selectedEdgeIds.length === 0}
              onClick={() => {
                const selectedNodeSet = new Set(selectedNodeIds)
                if (selectedNodeSet.size > 0) {
                  setNodes((previous) => previous.filter((node) => !selectedNodeSet.has(node.id)))
                  setEdges((previous) => previous.filter((edge) => !selectedNodeSet.has(edge.source) && !selectedNodeSet.has(edge.target)))
                  setSelectedNodeIds([])
                  setSelectedEdgeIds([])
                  setCompileResult(null)
                  return
                }
                if (selectedEdgeIds.length > 0) {
                  setEdges((previous) => previous.filter((edge) => !selectedEdgeIds.includes(edge.id)))
                  setSelectedEdgeIds([])
                  setCompileResult(null)
                }
              }}
            >删除选中</Button>
          </div>
        </CardHeader>
      </Card>

      <div className="relative h-[calc(100vh-190px)] min-h-[620px] rounded-md border border-border bg-background p-2">
        <Canvas
          nodes={nodes}
          edges={edges}
          selectedNodeIds={selectedNodeIds}
          selectedEdgeIds={selectedEdgeIds}
          invalidNodeIds={validation.invalidNodeIds}
          invalidEdgeIds={validation.invalidEdgeIds}
          onNodeMove={(nodeId, nextPosition) =>
            setNodes((previous) => previous.map((node) => (node.id === nodeId ? { ...node, position: nextPosition } : node)))
          }
          onSelectionChange={(ids) => {
            setSelectedNodeIds(ids)
            if (ids.length > 0) {
              setSelectedEdgeIds([])
              setPropertyOpen(true)
            }
          }}
          onEdgeSelectionChange={(ids) => {
            setSelectedEdgeIds(ids)
            if (ids.length > 0) setSelectedNodeIds([])
          }}
          canConnect={canConnect}
          onConnect={(source, target) => {
            setEdges((previous) => [...previous, { id: nextId('edge'), source, target }])
            setCompileResult(null)
          }}
        />

        {libraryOpen ? (
          <div className="absolute left-4 top-4 z-20 h-[calc(100%-2rem)] w-[320px] rounded-md border border-border bg-background/95 shadow-lg backdrop-blur-sm">
            <div className="flex h-full flex-col p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">节点库</p>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setLibraryOpen(false)}>收起</Button>
              </div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="搜索预设或自定义节点" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} />
              </div>
              <div className="space-y-2 overflow-auto pr-1">
                {visiblePresets.map((preset) => (
                  <button key={preset.id} className="w-full rounded-md border border-border px-3 py-2 text-left hover:bg-muted" onClick={() => setNodes((previous) => [...previous, createNode(preset, previous.length)])}>
                    <p className="text-xs text-muted-foreground">{preset.category}</p>
                    <p className="text-sm font-medium">+ {preset.name}</p>
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {propertyOpen ? (
          <div className="absolute right-4 top-4 z-20 h-[calc(100%-2rem)] w-[360px] rounded-md border border-border bg-background/95 shadow-lg backdrop-blur-sm">
            <div className="h-full overflow-auto p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">属性面板</p>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setPropertyOpen(false)}>收起</Button>
              </div>
              {!selectedNode ? (
                <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">请选择单个节点后编辑参数。</p>
              ) : (
                <>
                  <div className="mb-3 space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs text-muted-foreground">节点基础信息</p>
                    <Input value={String(selectedNode.data.label ?? '')} onChange={(event) => updateSelectedNodeData('label', event.target.value)} />
                  </div>

                  {selectedNode.type === 'fioJob' ? (
                    <div className="mb-3 space-y-2 rounded-md border border-border p-3">
                      <p className="text-xs text-muted-foreground">Fio 全参数（分组）</p>
                      {FIO_GROUPS.map((group) => (
                        <div key={group.id} className="rounded border border-border p-2">
                          <button className="mb-2 flex w-full items-center justify-between text-left text-xs font-medium" onClick={() => setCollapsedGroups((previous) => ({ ...previous, [group.id]: !previous[group.id] }))}>
                            <span>{group.title}</span>
                            <span>{collapsedGroups[group.id] ? '展开' : '收起'}</span>
                          </button>
                          {collapsedGroups[group.id] ? null : <div className="space-y-2">{group.fields.map((field) => renderFioField(field))}</div>}
                        </div>
                      ))}
                      <div className="space-y-1 rounded border border-dashed border-border p-2">
                        <p className="text-xs text-muted-foreground">额外自定义参数（最大兼容，手写）</p>
                        <Input placeholder="例如：randseed=42,io_submit_mode=offload" value={String(selectedNode.data.extraArgs ?? '')} onChange={(event) => updateSelectedNodeData('extraArgs', event.target.value)} />
                      </div>
                    </div>
                  ) : null}

                  {selectedNode.type === 'barrier' ? (
                    <div className="space-y-2 rounded-md border border-border p-3">
                      <p className="text-xs text-muted-foreground">阶段控制（BarrierNode）</p>
                      <Input value={String(selectedNode.data.phase ?? '')} onChange={(event) => updateSelectedNodeData('phase', event.target.value)} />
                      <label className="flex items-center gap-2 text-xs text-foreground">
                        <input type="checkbox" checked={Boolean(selectedNode.data.stonewall)} onChange={(event) => updateSelectedNodeData('stonewall', event.target.checked)} />
                        开启 stonewall
                      </label>
                    </div>
                  ) : null}
                </>
              )}


              {compileResult ? (
                <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs">
                  <p className="mb-2 font-medium text-emerald-600">预览模式（{compileResult.taskList.tasks.length} 个任务）</p>
                  <div className="space-y-2">
                    {compileResult.taskList.tasks.map((task, taskIndex) => (
                      <div key={`${task.name}-${taskIndex}`} className="rounded border border-emerald-500/30 p-2">
                        <p className="font-medium">Task {taskIndex + 1}: {task.name}</p>
                        <ul className="ml-4 list-disc">
                          {task.jobs.map((job, jobIndex) => (
                            <li key={`${job.name}-${jobIndex}`}>Job {jobIndex + 1}: {job.name} · rw={job.rw} · bs={job.bs} · nodeId={job.nodeId ?? '-'}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {runError ? <p className="mt-2 text-xs text-red-500">执行失败：{runError}</p> : null}

              {validation.errors.length > 0 ? (
                <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-3">
                  <p className="mb-2 text-xs font-medium text-red-500">拓扑错误</p>
                  <ul className="list-inside list-disc space-y-1 text-xs text-red-500">
                    {validation.errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">暂无校验错误。</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
