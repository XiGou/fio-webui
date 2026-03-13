import type { CSSProperties, PointerEvent } from 'react'

export type WorkflowNodeKind = 'start' | 'end' | 'fioJob' | 'barrier'

export type BaseWorkflowNodeData = {
  label: string
  [key: string]: string | number | boolean | undefined
}

export interface WorkflowCanvasNode {
  id: string
  type: WorkflowNodeKind
  position: { x: number; y: number }
  data: BaseWorkflowNodeData
}

type NodeRendererProps = {
  node: WorkflowCanvasNode
  selected: boolean
  invalid: boolean
  onStartConnect: (nodeId: string) => void
  onCompleteConnect: (nodeId: string) => void
  onPointerDown: (event: PointerEvent<HTMLDivElement>, nodeId: string) => void
}

const typeStyleMap: Record<WorkflowNodeKind, CSSProperties> = {
  start: { borderColor: '#22c55e', boxShadow: '0 0 0 1px rgba(34,197,94,.3)' },
  end: { borderColor: '#f97316', boxShadow: '0 0 0 1px rgba(249,115,22,.35)' },
  fioJob: { borderColor: '#38bdf8', boxShadow: '0 0 0 1px rgba(56,189,248,.35)' },
  barrier: { borderColor: '#f43f5e', boxShadow: '0 0 0 1px rgba(244,63,94,.35)' },
}

const typeLabelMap: Record<WorkflowNodeKind, string> = {
  start: 'Start',
  end: 'End',
  fioJob: 'Fio Job',
  barrier: 'Barrier',
}

export function NodeRenderer({
  node,
  selected,
  invalid,
  onStartConnect,
  onCompleteConnect,
  onPointerDown,
}: NodeRendererProps) {
  return (
    <div
      onPointerDown={(event) => onPointerDown(event, node.id)}
      className="relative min-w-[190px] rounded-lg border bg-card p-3 text-left shadow-sm"
      style={{
        ...typeStyleMap[node.type],
        outline: selected ? '2px solid rgb(16 185 129)' : undefined,
        opacity: invalid ? 0.75 : 1,
      }}
    >
      <div
        className="absolute -left-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-border bg-background"
        onPointerUp={() => onCompleteConnect(node.id)}
      />
      <div
        className="absolute -right-2 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-border bg-background"
        onPointerDown={(event) => {
          event.stopPropagation()
          onStartConnect(node.id)
        }}
      />

      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{typeLabelMap[node.type]}</p>
      <p className="text-sm font-semibold text-foreground">{node.data.label || '未命名节点'}</p>
      {node.type === 'fioJob' ? (
        <p className="text-xs text-muted-foreground">
          rw: {String(node.data.rw ?? 'read')} / bs: {String(node.data.bs ?? '4k')}
        </p>
      ) : null}
      {node.type === 'barrier' ? (
        <p className="text-xs text-muted-foreground">
          stonewall: {node.data.stonewall ? 'on' : 'off'}
        </p>
      ) : null}
      {invalid ? <p className="mt-1 text-xs text-red-500">拓扑异常</p> : null}
    </div>
  )
}
