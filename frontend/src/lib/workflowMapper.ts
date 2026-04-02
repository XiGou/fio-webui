import type { FioTask, FioTaskList, GlobalConfig, JobConfig } from '@/types/api'
import {
  WORKFLOW_NODE_TYPE,
  type WorkflowDefinition,
  type WorkflowMappingResult,
  type WorkflowNode,
} from '@/types/workflow'

const DEFAULT_GLOBAL: GlobalConfig = {
  ioengine: 'libaio',
  direct: true,
  runtime: 60,
  time_based: true,
  group_reporting: true,
  log_avg_msec: 500,
  status_interval: 1,
  output_format: 'json',
}

function cloneJob(job: JobConfig): JobConfig {
  return { ...job }
}

function pickGlobal(global?: GlobalConfig): GlobalConfig {
  return global ? { ...global } : { ...DEFAULT_GLOBAL }
}

export function workflowToTaskList(workflow: WorkflowDefinition): WorkflowMappingResult {
  const warnings: string[] = []
  const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]))
  const indegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const node of workflow.nodes) {
    indegree.set(node.id, 0)
    adjacency.set(node.id, [])
  }

  for (const edge of workflow.edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      warnings.push(`忽略无效边: ${edge.id}`)
      continue
    }
    adjacency.get(edge.source)?.push(edge.target)
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  }

  const queue: string[] = []
  for (const [id, degree] of indegree.entries()) {
    if (degree === 0) {
      queue.push(id)
    }
  }

  const orderedNodes: WorkflowNode[] = []
  while (queue.length > 0) {
    const id = queue.shift()
    if (!id) break
    const node = nodeMap.get(id)
    if (!node) continue
    orderedNodes.push(node)

    for (const nextID of adjacency.get(id) ?? []) {
      const degree = (indegree.get(nextID) ?? 1) - 1
      indegree.set(nextID, degree)
      if (degree === 0) {
        queue.push(nextID)
      }
    }
  }

  if (orderedNodes.length !== workflow.nodes.length) {
    warnings.push('工作流存在循环或断裂，已按节点原顺序回退。')
    orderedNodes.length = 0
    orderedNodes.push(...workflow.nodes)
  }

  const tasks: FioTask[] = []
  let pendingTask: FioTask | null = null

  const flushPending = () => {
    if (pendingTask && pendingTask.jobs.length > 0) {
      tasks.push(pendingTask)
    }
    pendingTask = null
  }

  for (const node of orderedNodes) {
    switch (node.type) {
      case WORKFLOW_NODE_TYPE.FIO_JOB: {
        const cfg = node.config as { taskName?: string; global?: GlobalConfig; job: JobConfig }
        if (!pendingTask) {
          pendingTask = {
            name: cfg.taskName || node.label || `task-${tasks.length + 1}`,
            global: pickGlobal(cfg.global),
            jobs: [],
          }
        }
        pendingTask.jobs.push(cloneJob(cfg.job))
        break
      }
      case WORKFLOW_NODE_TYPE.CONTROL_STONEWALL: {
        if (!pendingTask || pendingTask.jobs.length === 0) {
          warnings.push(`stonewall 节点 ${node.id} 没有前置 job，已忽略。`)
          break
        }
        pendingTask.jobs[pendingTask.jobs.length - 1] = {
          ...pendingTask.jobs[pendingTask.jobs.length - 1],
          stonewallAfter: true,
        }
        flushPending()
        break
      }
      case WORKFLOW_NODE_TYPE.GROUP_PARALLEL: {
        flushPending()
        const cfg = node.config as { taskName?: string; global?: GlobalConfig; jobs: JobConfig[] }
        tasks.push({
          name: cfg.taskName || node.label || `parallel-${tasks.length + 1}`,
          global: pickGlobal(cfg.global),
          jobs: cfg.jobs.map(cloneJob),
        })
        break
      }
      case WORKFLOW_NODE_TYPE.REPORT_MARKER:
        flushPending()
        break
      default:
        warnings.push(`未知节点类型 ${String((node as { type?: string }).type)}，已忽略。`)
    }
  }

  flushPending()

  return {
    taskList: { tasks },
    warnings,
  }
}

export function taskListToWorkflow(taskList: FioTaskList): WorkflowDefinition {
  const nodes: WorkflowNode[] = []
  const edges: Array<{ id: string; source: string; target: string }> = []
  let lastNodeId = ''
  let nodeSeq = 0

  const appendNode = (node: WorkflowNode) => {
    nodes.push(node)
    if (lastNodeId) {
      edges.push({ id: `edge-${lastNodeId}-${node.id}`, source: lastNodeId, target: node.id })
    }
    lastNodeId = node.id
  }

  for (const task of taskList.tasks) {
    if (task.jobs.length > 1 && !task.jobs.some((job) => job.stonewallAfter)) {
      nodeSeq += 1
      appendNode({
        id: `node-${nodeSeq}`,
        type: WORKFLOW_NODE_TYPE.GROUP_PARALLEL,
        label: task.name,
        config: {
          taskName: task.name,
          global: { ...task.global },
          jobs: task.jobs.map(cloneJob),
        },
      })
      continue
    }

    for (const job of task.jobs) {
      nodeSeq += 1
      const jobNodeId = `node-${nodeSeq}`
      appendNode({
        id: jobNodeId,
        type: WORKFLOW_NODE_TYPE.FIO_JOB,
        label: job.name,
        config: {
          taskName: task.name,
          global: { ...task.global },
          job: cloneJob({ ...job, stonewallAfter: false }),
        },
      })

      if (job.stonewallAfter) {
        nodeSeq += 1
        appendNode({
          id: `node-${nodeSeq}`,
          type: WORKFLOW_NODE_TYPE.CONTROL_STONEWALL,
          label: 'stonewall',
          config: { enabled: true },
        })
      }
    }
  }

  return {
    version: 1,
    nodes,
    edges,
    entryNodeId: nodes[0]?.id,
  }
}
