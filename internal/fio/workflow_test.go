package fio

import "testing"

func testGlobal() GlobalConfig {
	return GlobalConfig{
		IOEngine:       IOEngineLibaio,
		Direct:         true,
		Runtime:        60,
		TimeBased:      true,
		GroupReport:    true,
		LogAvgMsec:     500,
		StatusInterval: 1,
		OutputFormat:   "json",
	}
}

func testJob(name string) JobConfig {
	return JobConfig{
		Name:      name,
		Filename:  "/tmp/fio",
		RW:        RWRandRead,
		BS:        "4k",
		Size:      "1G",
		NumJobs:   1,
		IODepth:   1,
		RWMixRead: 50,
	}
}

func TestBuildWorkflowFromTaskList_ParallelTask(t *testing.T) {
	taskList := &FioTaskList{Tasks: []FioTask{{
		Name:   "parallel",
		Global: testGlobal(),
		Jobs:   []JobConfig{testJob("j1"), testJob("j2")},
	}}}

	wf := BuildWorkflowFromTaskList(taskList)
	if len(wf.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(wf.Nodes))
	}
	if wf.Nodes[0].Type != WorkflowNodeTypeGroupParallel {
		t.Fatalf("expected node type %s, got %s", WorkflowNodeTypeGroupParallel, wf.Nodes[0].Type)
	}
}

func TestBuildWorkflowFromTaskList_SequentialJobs(t *testing.T) {
	taskList := &FioTaskList{Tasks: []FioTask{{
		Name:   "seq",
		Global: testGlobal(),
		Jobs:   []JobConfig{testJob("j1"), testJob("j2")},
	}, {
		Name:   "next",
		Global: testGlobal(),
		Jobs:   []JobConfig{testJob("j3")},
	}}}

	wf := BuildWorkflowFromTaskList(taskList)
	if len(wf.Nodes) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(wf.Nodes))
	}
	if wf.Nodes[0].Type != WorkflowNodeTypeGroupParallel {
		t.Fatalf("unexpected first node type: %s", wf.Nodes[0].Type)
	}
	if wf.Nodes[1].Type != WorkflowNodeTypeFioJob {
		t.Fatalf("unexpected second node type: %s", wf.Nodes[1].Type)
	}
	if wf.EntryNodeID != wf.Nodes[0].ID {
		t.Fatalf("expected entry node %s, got %s", wf.Nodes[0].ID, wf.EntryNodeID)
	}
}

func TestBuildWorkflowFromTaskList_Stonewall(t *testing.T) {
	j1 := testJob("j1")
	j1.StonewallAfter = true
	taskList := &FioTaskList{Tasks: []FioTask{{
		Name:   "stonewall",
		Global: testGlobal(),
		Jobs:   []JobConfig{j1, testJob("j2")},
	}}}

	wf := BuildWorkflowFromTaskList(taskList)
	if len(wf.Nodes) != 3 {
		t.Fatalf("expected 3 nodes, got %d", len(wf.Nodes))
	}
	if wf.Nodes[1].Type != WorkflowNodeTypeControlStonewall {
		t.Fatalf("expected middle node stonewall, got %s", wf.Nodes[1].Type)
	}
	if len(wf.Edges) != 2 {
		t.Fatalf("expected 2 edges, got %d", len(wf.Edges))
	}
}
