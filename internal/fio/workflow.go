package fio

import "strconv"

const (
	WorkflowNodeTypeFioJob           = "fio.job"
	WorkflowNodeTypeControlStonewall = "control.stonewall"
	WorkflowNodeTypeGroupParallel    = "group.parallel"
	WorkflowNodeTypeReportMarker     = "report.marker"
)

// WorkflowNode describes a node in a persisted workflow definition.
type WorkflowNode struct {
	ID     string         `json:"id"`
	Type   string         `json:"type"`
	Label  string         `json:"label,omitempty"`
	Config map[string]any `json:"config,omitempty"`
}

// WorkflowEdge defines directed execution flow between two workflow nodes.
type WorkflowEdge struct {
	ID     string `json:"id"`
	Source string `json:"source"`
	Target string `json:"target"`
}

// WorkflowDefinition is the JSON-serializable workflow representation.
type WorkflowDefinition struct {
	Version     int            `json:"version"`
	Name        string         `json:"name,omitempty"`
	Nodes       []WorkflowNode `json:"nodes"`
	Edges       []WorkflowEdge `json:"edges"`
	EntryNodeID string         `json:"entryNodeId,omitempty"`
}

// RunConfig persists both legacy task list and normalized workflow for compatibility.
type RunConfig struct {
	TaskList *FioTaskList        `json:"task_list,omitempty"`
	Workflow *WorkflowDefinition `json:"workflow,omitempty"`
}

func BuildWorkflowFromTaskList(taskList *FioTaskList) *WorkflowDefinition {
	if taskList == nil {
		return nil
	}
	nodes := make([]WorkflowNode, 0)
	edges := make([]WorkflowEdge, 0)
	lastNodeID := ""
	nodeSeq := 0

	appendNode := func(node WorkflowNode) {
		nodes = append(nodes, node)
		if lastNodeID != "" {
			edges = append(edges, WorkflowEdge{
				ID:     "edge-" + lastNodeID + "-" + node.ID,
				Source: lastNodeID,
				Target: node.ID,
			})
		}
		lastNodeID = node.ID
	}

	for _, task := range taskList.Tasks {
		hasStonewall := false
		for _, job := range task.Jobs {
			if job.StonewallAfter {
				hasStonewall = true
				break
			}
		}
		if len(task.Jobs) > 1 && !hasStonewall {
			nodeSeq++
			appendNode(WorkflowNode{
				ID:    nodeID(nodeSeq),
				Type:  WorkflowNodeTypeGroupParallel,
				Label: task.Name,
				Config: map[string]any{
					"taskName": task.Name,
					"global":   task.Global,
					"jobs":     task.Jobs,
				},
			})
			continue
		}

		for _, job := range task.Jobs {
			nodeSeq++
			appendNode(WorkflowNode{
				ID:    nodeID(nodeSeq),
				Type:  WorkflowNodeTypeFioJob,
				Label: job.Name,
				Config: map[string]any{
					"taskName": task.Name,
					"global":   task.Global,
					"job":      job,
				},
			})
			if job.StonewallAfter {
				nodeSeq++
				appendNode(WorkflowNode{
					ID:    nodeID(nodeSeq),
					Type:  WorkflowNodeTypeControlStonewall,
					Label: "stonewall",
					Config: map[string]any{
						"enabled": true,
					},
				})
			}
		}
	}

	wf := &WorkflowDefinition{Version: 1, Nodes: nodes, Edges: edges}
	if len(nodes) > 0 {
		wf.EntryNodeID = nodes[0].ID
	}
	return wf
}

func nodeID(seq int) string {
	return "node-" + strconv.Itoa(seq)
}
