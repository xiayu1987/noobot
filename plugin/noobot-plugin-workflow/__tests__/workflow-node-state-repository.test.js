/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_NODE_STATUS,
  createInMemoryWorkflowNodeStateRepository,
} from "../src/core/orchestrator/node-state-repository.js";

const nodes = [
  {
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    commandId: "workflow-node:node-a-exec:send",
    dialogProcessId: "wf_node_node-a-exec",
    turnScopeId: "workflow-node:node-a-exec",
    nodeId: "a",
    nodeName: "A",
    stepStatus: "ready",
    dependencies: [],
  },
  {
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-b-exec",
    commandId: "workflow-node:node-b-exec:send",
    dialogProcessId: "wf_node_node-b-exec",
    turnScopeId: "workflow-node:node-b-exec",
    nodeId: "b",
    nodeName: "B",
    stepStatus: "pending",
    dependencies: ["a"],
  },
];

test("workflow node state repository initializes planning snapshot with stable identities", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  const snapshot = await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });

  assert.equal(snapshot.workflowRunId, "wf-run-1");
  assert.equal(snapshot.sequence, 2);
  assert.equal(snapshot.nodes.length, 2);
  assert.equal(snapshot.nodes[0].status, WORKFLOW_NODE_STATUS.READY);
  assert.equal(snapshot.nodes[1].status, WORKFLOW_NODE_STATUS.PENDING);
  assert.equal(snapshot.nodes[0].revision, 1);
  assert.equal(snapshot.nodes[0].eventId, "workflow_node_state:wf-run-1:node-a-exec:1");
  assert.equal(snapshot.nodes[0].commandId, nodes[0].commandId);
});

test("workflow node state repository commits running and terminal with monotonic revision and sequence", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });

  const running = await repo.commit({
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    status: WORKFLOW_NODE_STATUS.RUNNING,
    expectedRevision: 1,
  });
  assert.equal(running.applied, true);
  assert.equal(running.node.status, WORKFLOW_NODE_STATUS.RUNNING);
  assert.equal(running.node.revision, 2);
  assert.equal(running.node.sequence, 3);
  assert.ok(running.node.startedAt);
  assert.equal(running.node.eventId, "workflow_node_state:wf-run-1:node-a-exec:2");

  const succeeded = await repo.commit({
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    status: WORKFLOW_NODE_STATUS.SUCCEEDED,
    expectedRevision: 2,
    sessionId: "child-a",
  });
  assert.equal(succeeded.node.status, WORKFLOW_NODE_STATUS.SUCCEEDED);
  assert.equal(succeeded.node.revision, 3);
  assert.equal(succeeded.node.sequence, 4);
  assert.equal(succeeded.node.sessionId, "child-a");
  assert.ok(succeeded.node.completedAt);
});

test("workflow node state repository deduplicates same target and rejects revision conflicts", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  const running = await repo.commit({
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    status: WORKFLOW_NODE_STATUS.RUNNING,
    expectedRevision: 1,
  });
  const duplicate = await repo.commit({
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    status: WORKFLOW_NODE_STATUS.RUNNING,
    expectedRevision: 1,
  });
  assert.equal(duplicate.applied, false);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.node.eventId, running.node.eventId);

  await assert.rejects(
    repo.commit({
      workflowRunId: "wf-run-1",
      nodeExecutionId: "node-a-exec",
      status: WORKFLOW_NODE_STATUS.FAILED,
      expectedRevision: 1,
      failure: { message: "boom" },
    }),
    /revision conflict/,
  );
});

test("workflow node state repository protects terminal nodes from rollback", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  await repo.commit({ workflowRunId: "wf-run-1", nodeExecutionId: "node-a-exec", status: "running", expectedRevision: 1 });
  await repo.commit({ workflowRunId: "wf-run-1", nodeExecutionId: "node-a-exec", status: "failed", expectedRevision: 2, failure: "boom" });

  await assert.rejects(
    repo.commit({ workflowRunId: "wf-run-1", nodeExecutionId: "node-a-exec", status: "running", expectedRevision: 3 }),
    /terminal/,
  );
});

test("workflow node state repository isolates parallel nodes and supports reload", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  await repo.commit({ workflowRunId: "wf-run-1", nodeExecutionId: "node-a-exec", status: "running", expectedRevision: 1 });
  await repo.commit({ workflowRunId: "wf-run-1", nodeExecutionId: "node-b-exec", status: "running", expectedRevision: 1 });

  const state = repo.exportState();
  const reloaded = createInMemoryWorkflowNodeStateRepository({ initialState: state });
  const snapshot = await reloaded.getSnapshot({ workflowRunId: "wf-run-1" });
  const a = snapshot.nodes.find((item) => item.nodeExecutionId === "node-a-exec");
  const b = snapshot.nodes.find((item) => item.nodeExecutionId === "node-b-exec");
  assert.equal(a.status, WORKFLOW_NODE_STATUS.RUNNING);
  assert.equal(b.status, WORKFLOW_NODE_STATUS.RUNNING);
  assert.notEqual(a.sequence, b.sequence);
});
