import type { MouseEvent } from 'react'
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
  selected: boolean
  onSelect?: (edgeId: string, multi: boolean) => void
}

const NODE_WIDTH = 190
const NODE_HEIGHT = 92

export function EdgeRenderer({ edge, nodesById, invalid, selected, onSelect }: EdgeRendererProps) {
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

  const handleClick = (event: MouseEvent<SVGPathElement>) => {
    event.stopPropagation()
    onSelect?.(edge.id, event.shiftKey || event.metaKey || event.ctrlKey)
  }

  return (
    <g>
      <path d={path} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" onClick={handleClick} />
      <path
        d={path}
        fill="none"
        stroke={selected ? '#2563eb' : invalid ? '#ef4444' : '#64748b'}
        strokeWidth={selected ? 2.8 : invalid ? 2.5 : 1.8}
        strokeDasharray={invalid ? '5 4' : undefined}
      />
      <circle cx={tx} cy={ty} r={selected ? 3.2 : 2.5} fill={selected ? '#2563eb' : invalid ? '#ef4444' : '#64748b'} />
    </g>
  )
}
