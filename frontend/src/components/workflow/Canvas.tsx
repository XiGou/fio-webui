import { useMemo, useRef, useState, type PointerEvent } from 'react'
import { EdgeRenderer, type WorkflowCanvasEdge } from './EdgeRenderer'
import { NodeRenderer, type WorkflowCanvasNode } from './NodeRenderer'

type CanvasProps = {
  nodes: WorkflowCanvasNode[]
  edges: WorkflowCanvasEdge[]
  selectedNodeIds: string[]
  invalidNodeIds: Set<string>
  invalidEdgeIds: Set<string>
  onNodeMove: (nodeId: string, nextPosition: { x: number; y: number }) => void
  onSelectionChange: (nodeIds: string[]) => void
  onConnect: (source: string, target: string) => void
  canConnect?: (source: string, target: string) => boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export function Canvas({
  nodes,
  edges,
  selectedNodeIds,
  invalidNodeIds,
  invalidEdgeIds,
  onNodeMove,
  onSelectionChange,
  onConnect,
  canConnect,
}: CanvasProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ x: 240, y: 160, zoom: 1 })
  const [draggingNode, setDraggingNode] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [selectingRect, setSelectingRect] = useState<
    | {
        start: { x: number; y: number }
        end: { x: number; y: number }
      }
    | null
  >(null)
  const [isPanning, setIsPanning] = useState<{ x: number; y: number; originX: number; originY: number } | null>(
    null
  )

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])

  const getWorldPos = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = wrapperRef.current?.getBoundingClientRect()
    if (!bounds) {
      return { x: 0, y: 0 }
    }
    return {
      x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (event.clientY - bounds.top - viewport.y) / viewport.zoom,
    }
  }

  const onNodePointerDown = (event: PointerEvent<HTMLDivElement>, nodeId: string) => {
    if (event.button !== 0) {
      return
    }
    event.stopPropagation()
    const world = getWorldPos(event)
    const node = nodesById.get(nodeId)
    if (!node) {
      return
    }

    setDraggingNode({
      id: nodeId,
      dx: world.x - node.position.x,
      dy: world.y - node.position.y,
    })

    if (!selectedNodeIds.includes(nodeId)) {
      onSelectionChange([nodeId])
    }
  }

  const onCanvasPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 1) {
      setIsPanning({ x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y })
      return
    }
    if (event.button !== 0) {
      return
    }

    if (connectingFrom) {
      setConnectingFrom(null)
      return
    }

    if (event.shiftKey) {
      const world = getWorldPos(event)
      setSelectingRect({ start: world, end: world })
    } else {
      onSelectionChange([])
    }
  }

  const onCanvasPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (draggingNode) {
      const world = getWorldPos(event)
      onNodeMove(draggingNode.id, {
        x: world.x - draggingNode.dx,
        y: world.y - draggingNode.dy,
      })
    }

    if (selectingRect) {
      const world = getWorldPos(event)
      setSelectingRect((previous) => (previous ? { ...previous, end: world } : previous))
    }

    if (isPanning) {
      const nextX = isPanning.originX + event.clientX - isPanning.x
      const nextY = isPanning.originY + event.clientY - isPanning.y
      setViewport((previous) => ({ ...previous, x: nextX, y: nextY }))
    }
  }

  const onCanvasPointerUp = () => {
    setDraggingNode(null)
    setIsPanning(null)
    if (selectingRect) {
      const minX = Math.min(selectingRect.start.x, selectingRect.end.x)
      const maxX = Math.max(selectingRect.start.x, selectingRect.end.x)
      const minY = Math.min(selectingRect.start.y, selectingRect.end.y)
      const maxY = Math.max(selectingRect.start.y, selectingRect.end.y)

      const selected = nodes
        .filter((node) => {
          const nx = node.position.x
          const ny = node.position.y
          return nx + 190 >= minX && nx <= maxX && ny + 92 >= minY && ny <= maxY
        })
        .map((node) => node.id)

      onSelectionChange(selected)
      setSelectingRect(null)
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="relative h-full overflow-hidden rounded-md border border-border bg-white"
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerLeave={onCanvasPointerUp}
      onWheel={(event) => {
        event.preventDefault()
        const nextZoom = clamp(viewport.zoom - event.deltaY * 0.0012, 0.25, 2.5)
        setViewport((previous) => ({ ...previous, zoom: nextZoom }))
      }}
    >
      <div className="absolute inset-0 bg-white" />

      <div
        className="absolute inset-0 origin-top-left"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
          {edges.map((edge) => (
            <EdgeRenderer key={edge.id} edge={edge} nodesById={nodesById} invalid={invalidEdgeIds.has(edge.id)} />
          ))}
        </svg>

        {nodes.map((node) => (
          <div key={node.id} className="absolute" style={{ left: node.position.x, top: node.position.y }}>
            <NodeRenderer
              node={node}
              selected={selectedNodeIds.includes(node.id)}
              invalid={invalidNodeIds.has(node.id)}
              onStartConnect={(source) => setConnectingFrom(source)}
              onCompleteConnect={(target) => {
                if (connectingFrom) {
                  if (!canConnect || canConnect(connectingFrom, target)) {
                    onConnect(connectingFrom, target)
                  }
                }
                setConnectingFrom(null)
              }}
              onPointerDown={onNodePointerDown}
            />
          </div>
        ))}
      </div>

      {selectingRect ? (
        <div
          className="pointer-events-none absolute border border-emerald-400/80 bg-emerald-400/15"
          style={{
            left: Math.min(selectingRect.start.x, selectingRect.end.x) * viewport.zoom + viewport.x,
            top: Math.min(selectingRect.start.y, selectingRect.end.y) * viewport.zoom + viewport.y,
            width: Math.abs(selectingRect.start.x - selectingRect.end.x) * viewport.zoom,
            height: Math.abs(selectingRect.start.y - selectingRect.end.y) * viewport.zoom,
          }}
        />
      ) : null}

      <div className="absolute right-3 top-3 rounded border border-border bg-background/90 px-2 py-1 text-xs text-muted-foreground">
        缩放 {Math.round(viewport.zoom * 100)}% · Shift + 拖拽框选 · 中键平移 {connectingFrom ? `· 连线中: ${connectingFrom}` : ''}
      </div>
    </div>
  )
}
