import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Canvas } from '@/components/workflow/Canvas'
import type { WorkflowCanvasEdge } from '@/components/workflow/EdgeRenderer'
import type { WorkflowCanvasNode, WorkflowNodeKind } from '@/components/workflow/NodeRenderer'

const VERSION_ITEMS = ['草稿工作流', '模板库', '已发布工作流']

type ValidationResult = {
  errors: string[]
  invalidNodeIds: Set<string>
  invalidEdgeIds: Set<string>
}

const createNode = (type: WorkflowNodeKind, index: number): WorkflowCanvasNode => {
  const id = `${type}-${Math.random().toString(36).slice(2, 8)}`
  const base = { id, type, position: { x: 70 + index * 40, y: 60 + index * 34 }, data: { label: `${type}-${index + 1}` } }
  if (type === 'fioJob') {
    return { ...base, data: { ...base.data, rw: 'read', bs: '4k', iodepth: 1 } }
  }
  if (type === 'barrier') {
    return { ...base, data: { ...base.data, stonewall: true, phase: 'phase-1' } }
  }
  return base
}

const validateTopology = (nodes: WorkflowCanvasNode[], edges: WorkflowCanvasEdge[]): ValidationResult => {
  const errors: string[] = []
  const invalidNodeIds = new Set<string>()
  const invalidEdgeIds = new Set<string>()

  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    outDegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }

  const unique = new Set<string>()
  for (const edge of edges) {
    if (edge.source === edge.target) {
      invalidEdgeIds.add(edge.id)
      invalidNodeIds.add(edge.source)
      errors.push(`节点 ${edge.source} 存在自环连接。`)
      continue
    }
    const key = `${edge.source}->${edge.target}`
    if (unique.has(key)) {
      invalidEdgeIds.add(edge.id)
      errors.push(`存在重复连线 ${key}。`)
      continue
    }
    unique.add(key)

    const source = nodes.find((item) => item.id === edge.source)
    const target = nodes.find((item) => item.id === edge.target)

    if (!source || !target) {
      invalidEdgeIds.add(edge.id)
      errors.push(`连线 ${edge.id} 指向不存在的节点。`)
      continue
    }

    if (source.type === 'end' || target.type === 'start') {
      invalidEdgeIds.add(edge.id)
      invalidNodeIds.add(source.id)
      invalidNodeIds.add(target.id)
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
    if (visited.has(nodeId)) {
      return
    }

    visiting.add(nodeId)
    for (const nextId of adjacency.get(nodeId) ?? []) {
      dfs(nextId)
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
  }

  nodes.forEach((node) => dfs(node.id))

  return {
    errors: Array.from(new Set(errors)),
    invalidNodeIds,
    invalidEdgeIds,
  }
}

export function WorkflowStudioPage() {
  const [activeVersion, setActiveVersion] = useState(VERSION_ITEMS[0])
  const [nodes, setNodes] = useState<WorkflowCanvasNode[]>([
    { id: 'start-1', type: 'start', position: { x: 80, y: 120 }, data: { label: '开始' } },
    {
      id: 'fio-1',
      type: 'fioJob',
      position: { x: 360, y: 120 },
      data: { label: '顺序读', rw: 'read', bs: '128k', iodepth: 1 },
    },
    { id: 'end-1', type: 'end', position: { x: 650, y: 120 }, data: { label: '结束' } },
  ])
  const [edges, setEdges] = useState<WorkflowCanvasEdge[]>([
    { id: 'edge-1', source: 'start-1', target: 'fio-1' },
    { id: 'edge-2', source: 'fio-1', target: 'end-1' },
  ])
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [validation, setValidation] = useState<ValidationResult>({
    errors: [],
    invalidNodeIds: new Set(),
    invalidEdgeIds: new Set(),
  })

  const selectedNode = useMemo(
    () => nodes.find((node) => selectedNodeIds.length === 1 && node.id === selectedNodeIds[0]),
    [nodes, selectedNodeIds]
  )

  const updateSelectedNodeData = (field: string, value: string | number | boolean) => {
    if (!selectedNode) {
      return
    }
    setNodes((previous) =>
      previous.map((node) =>
        node.id === selectedNode.id
          ? {
              ...node,
              data: {
                ...node.data,
                [field]: value,
              },
            }
          : node
      )
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-foreground">
        <strong>Studio 新体验：</strong>无限画布 + 节点拖拽 + 连线 + 框选 + 缩放。
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base font-medium">工作流工作台</CardTitle>
            <p className="text-xs text-muted-foreground">三栏布局：节点库 / 画布 / 属性面板</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">版本菜单</span>
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-xs">
              <span>{activeVersion}</span>
              <div className="flex gap-1">
                {VERSION_ITEMS.map((item) => (
                  <Button
                    key={item}
                    size="sm"
                    variant={item === activeVersion ? 'default' : 'ghost'}
                    className="h-7 px-2 text-xs"
                    onClick={() => setActiveVersion(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid min-h-[680px] grid-cols-12 gap-4">
        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">节点库</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Button className="w-full justify-start" variant="outline" onClick={() => setNodes((prev) => [...prev, createNode('start', prev.length)])}>
              + StartNode
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setNodes((prev) => [...prev, createNode('fioJob', prev.length)])}>
              + FioJobNode
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setNodes((prev) => [...prev, createNode('barrier', prev.length)])}>
              + BarrierNode
            </Button>
            <Button className="w-full justify-start" variant="outline" onClick={() => setNodes((prev) => [...prev, createNode('end', prev.length)])}>
              + EndNode
            </Button>
            <Button
              className="w-full"
              onClick={() => {
                const result = validateTopology(nodes, edges)
                setValidation(result)
              }}
            >
              运行前拓扑校验
            </Button>
          </CardContent>
        </Card>

        <Card className="col-span-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">画布</CardTitle>
          </CardHeader>
          <CardContent className="h-[560px]">
            <Canvas
              nodes={nodes}
              edges={edges}
              selectedNodeIds={selectedNodeIds}
              invalidNodeIds={validation.invalidNodeIds}
              invalidEdgeIds={validation.invalidEdgeIds}
              onNodeMove={(nodeId, nextPosition) =>
                setNodes((previous) =>
                  previous.map((node) => (node.id === nodeId ? { ...node, position: nextPosition } : node))
                )
              }
              onSelectionChange={setSelectedNodeIds}
              onConnect={(source, target) => {
                setEdges((previous) => [
                  ...previous,
                  { id: `edge-${crypto.randomUUID()}`, source, target },
                ])
              }}
            />
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">属性面板</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!selectedNode ? (
              <p className="rounded-md border border-dashed border-border p-3 text-muted-foreground">
                请选择单个节点后编辑参数。
              </p>
            ) : (
              <>
                <div className="space-y-2 rounded-md border border-border p-3">
                  <p className="text-xs text-muted-foreground">节点基础信息</p>
                  <Input
                    value={String(selectedNode.data.label ?? '')}
                    onChange={(event) => updateSelectedNodeData('label', event.target.value)}
                  />
                </div>

                {selectedNode.type === 'fioJob' ? (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs text-muted-foreground">执行参数（FioJobNode）</p>
                    <Input value={String(selectedNode.data.rw ?? '')} onChange={(event) => updateSelectedNodeData('rw', event.target.value)} />
                    <Input value={String(selectedNode.data.bs ?? '')} onChange={(event) => updateSelectedNodeData('bs', event.target.value)} />
                    <Input
                      type="number"
                      value={Number(selectedNode.data.iodepth ?? 1)}
                      onChange={(event) => updateSelectedNodeData('iodepth', Number(event.target.value))}
                    />
                  </div>
                ) : null}

                {selectedNode.type === 'barrier' ? (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-xs text-muted-foreground">阶段控制（BarrierNode）</p>
                    <Input
                      value={String(selectedNode.data.phase ?? '')}
                      onChange={(event) => updateSelectedNodeData('phase', event.target.value)}
                    />
                    <label className="flex items-center gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedNode.data.stonewall)}
                        onChange={(event) => updateSelectedNodeData('stonewall', event.target.checked)}
                      />
                      开启 stonewall
                    </label>
                  </div>
                ) : null}
              </>
            )}

            {validation.errors.length > 0 ? (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3">
                <p className="mb-2 text-xs font-medium text-red-300">拓扑错误</p>
                <ul className="list-inside list-disc space-y-1 text-xs text-red-200">
                  {validation.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">暂无校验错误。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
