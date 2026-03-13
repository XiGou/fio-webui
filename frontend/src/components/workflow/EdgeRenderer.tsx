import type { WorkflowCanvasNode } from './NodeRenderer'

export interface WorkflowCanvasEdge {
  id: string
  source: string
  target: string
}

type EdgeRendererProps = {
  edge: WorkflowCanvasEdge
  nodesById: Map<string, WorkflowCanvasNode>
  invalid: boolean
}

const NODE_WIDTH = 190
const NODE_HEIGHT = 92

export function EdgeRenderer({ edge, nodesById, invalid }: EdgeRendererProps) {
  const sourceNode = nodesById.get(edge.source)
  const targetNode = nodesById.get(edge.target)

  if (!sourceNode || !targetNode) {
    return null
  }

  const sx = sourceNode.position.x + NODE_WIDTH
  const sy = sourceNode.position.y + NODE_HEIGHT / 2
  const tx = targetNode.position.x
  const ty = targetNode.position.y + NODE_HEIGHT / 2
  const cx = Math.max(36, Math.abs(tx - sx) * 0.5)
  const path = `M ${sx} ${sy} C ${sx + cx} ${sy}, ${tx - cx} ${ty}, ${tx} ${ty}`

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={invalid ? '#ef4444' : '#64748b'}
        strokeWidth={invalid ? 2.5 : 1.8}
        strokeDasharray={invalid ? '5 4' : undefined}
      />
      <circle cx={tx} cy={ty} r={2.5} fill={invalid ? '#ef4444' : '#64748b'} />
    </g>
  )
}
