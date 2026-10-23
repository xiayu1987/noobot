/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_NODE_STATUS,
  createInMemoryWorkflowNodeStateRepository,
} from "../../src/core/orchestrator/node-state-repository.js";

const nodes = [
  {
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    commandId: "workflow-node:node-a-exec:send",
    dialogProcessId: "wf_node_node-a-exec",
    turnScopeId: "workflow-node:node-a-exec",
    nodeId: "a",
    nodeName: "A",
    attempt: 1,
    activeChildExecutionId: "agent:node-a-child",
    status: "ready",
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
    attempt: 1,
    activeChildExecutionId: "agent:node-b-child",
    status: "pending",
    dependencies: ["a"],
  },
];

test("workflow node state repository initializes planning snapshot with stable identities", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  const snapshot = await repo.initialize({
    workflowRunId: "wf-run-1",
    planningNodeSessions: nodes,
  });

  assert.equal(snapshot.workflowRunId, "wf-run-1");
  assert.equal(snapshot.sequence, 2);
  assert.equal(snapshot.nodes.length, 2);
  assert.equal(snapshot.nodes[0].status, WORKFLOW_NODE_STATUS.READY);
  assert.equal(snapshot.nodes[1].status, WORKFLOW_NODE_STATUS.PENDING);
  assert.equal(snapshot.nodes[0].revision, 1);
  assert.equal(snapshot.nodes[0].eventId, "workflow_node_state:wf-run-1:node-a-exec:1");
  assert.equal(snapshot.nodes[0].commandId, nodes[0].commandId);
});

function startNode(repo, nodeExecutionId, nodeSessionId) {
  return repo.commit({
    workflowRunId: "wf-run-1",
    nodeExecutionId,
    status: WORKFLOW_NODE_STATUS.RUNNING,
    expectedRevision: 1,
    nodeSessionId,
  });
}

test("workflow node state repository commits running and terminal with monotonic revision and sequence", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });

  const running = await startNode(repo, "node-a-exec", "child-a");
  assert.equal(running.node.status, WORKFLOW_NODE_STATUS.RUNNING);
  assert.equal(running.node.revision, 2);
  assert.equal(running.node.sequence, 3);
  assert.equal(running.node.nodeSessionId, "child-a");
  assert.deepEqual(running.node.attemptExecutionIds, ["agent:node-a-child"]);
  assert.ok(running.node.startedAt);
  assert.equal(running.node.eventId, "workflow_node_state:wf-run-1:node-a-exec:2");

  const succeeded = await repo.commit({
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    status: WORKFLOW_NODE_STATUS.SUCCEEDED,
    expectedRevision: 2,
  });
  assert.equal(succeeded.node.status, WORKFLOW_NODE_STATUS.SUCCEEDED);
  assert.equal(succeeded.node.revision, 3);
  assert.equal(succeeded.node.sequence, 4);
  assert.equal(succeeded.node.nodeSessionId, "child-a");
  assert.equal(succeeded.node.dialogProcessId, nodes[0].dialogProcessId);
  assert.equal(succeeded.node.failure, null);
  assert.equal("agentDialogProcessId" in succeeded.node, false);
  assert.ok(succeeded.node.completedAt);
});

test("workflow node state repository binds nodeSessionId only to the running transition", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  await assert.rejects(
    repo.commit({
      workflowRunId: "wf-run-1",
      nodeExecutionId: "node-a-exec",
      status: WORKFLOW_NODE_STATUS.RUNNING,
      expectedRevision: 1,
    }),
    /requires nodeSessionId/,
  );
  await startNode(repo, "node-a-exec", "child-a");
  await assert.rejects(
    repo.commit({
      workflowRunId: "wf-run-1",
      nodeExecutionId: "node-a-exec",
      status: WORKFLOW_NODE_STATUS.SUCCEEDED,
      expectedRevision: 2,
      nodeSessionId: "child-b",
    }),
    /bound only by the running transition/,
  );
});

test("workflow node state repository binds failure only to failed and stopped", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  await startNode(repo, "node-a-exec", "child-a");
  await assert.rejects(
    repo.commit({
      workflowRunId: "wf-run-1",
      nodeExecutionId: "node-a-exec",
      status: WORKFLOW_NODE_STATUS.FAILED,
      expectedRevision: 2,
      failure: { message: "boom" },
    }),
    /requires source, code and message/,
  );
  await assert.rejects(
    repo.commit({
      workflowRunId: "wf-run-1",
      nodeExecutionId: "node-a-exec",
      status: WORKFLOW_NODE_STATUS.SUCCEEDED,
      expectedRevision: 2,
      failure: { source: "workflow", code: "X", message: "x" },
    }),
    /carried only by failed\/stopped/,
  );
});

test("workflow node state repository rejects repeated and stale commits as revision conflicts", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  await startNode(repo, "node-a-exec", "child-a");
  await assert.rejects(startNode(repo, "node-a-exec", "child-a"), /revision conflict/);
  await assert.rejects(
    repo.commit({
      workflowRunId: "wf-run-1",
      nodeExecutionId: "node-a-exec",
      status: WORKFLOW_NODE_STATUS.FAILED,
      expectedRevision: 1,
      failure: { source: "workflow_node_agent", code: "BOOM", message: "boom" },
    }),
    /revision conflict/,
  );
});

test("workflow node state repository protects terminal nodes from rollback", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  await startNode(repo, "node-a-exec", "child-a");
  await repo.commit({
    workflowRunId: "wf-run-1",
    nodeExecutionId: "node-a-exec",
    status: WORKFLOW_NODE_STATUS.FAILED,
    expectedRevision: 2,
    failure: { source: "workflow_node_agent", code: "BOOM", message: "boom" },
  });

  await assert.rejects(
    repo.commit({
      workflowRunId: "wf-run-1",
      nodeExecutionId: "node-a-exec",
      status: WORKFLOW_NODE_STATUS.RUNNING,
      expectedRevision: 3,
      nodeSessionId: "child-a",
    }),
    /terminal/,
  );
});

test("workflow node state repository isolates parallel nodes in one run snapshot", async () => {
  const repo = createInMemoryWorkflowNodeStateRepository();
  await repo.initialize({ workflowRunId: "wf-run-1", planningNodeSessions: nodes });
  await startNode(repo, "node-a-exec", "child-a");
  await startNode(repo, "node-b-exec", "child-b");

  const snapshot = await repo.getSnapshot({ workflowRunId: "wf-run-1" });
  const a = snapshot.nodes.find((item) => item.nodeExecutionId === "node-a-exec");
  const b = snapshot.nodes.find((item) => item.nodeExecutionId === "node-b-exec");
  assert.equal(a.status, WORKFLOW_NODE_STATUS.RUNNING);
  assert.equal(b.status, WORKFLOW_NODE_STATUS.RUNNING);
  assert.equal(a.nodeSessionId, "child-a");
  assert.equal(b.nodeSessionId, "child-b");
  assert.notEqual(a.sequence, b.sequence);
  await assert.rejects(repo.getSnapshot({ workflowRunId: "wf-run-missing" }), /not initialized/);
});
