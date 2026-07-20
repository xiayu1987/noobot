/*
  Copyright (c) 2026 xiayu
  Contact: 126240622+xiayu1987@users.noreply.github.com
  SPDX-License-Identifier: MIT
*/
import test from "node:test";
import assert from "node:assert/strict";

import { parseWorkflowDslText } from "../src/protocol/text-protocol.js";
import {
  resolveWorkflowRunId,
  createWorkflowNodeIdentity,
  buildWorkflowPlanningNodeSessions,
} from "../src/core/workflow-run-identity.js";

test("workflow run and node identities are stable and attempt-scoped", () => {
  const ctx = { sessionId: "s1", dialogProcessId: "d1", workflowRunId: "run-explicit" };
  assert.equal(resolveWorkflowRunId(ctx), "run-explicit");
  const first = createWorkflowNodeIdentity({ workflowRunId: "run-explicit", node: { id: "a" } });
  const again = createWorkflowNodeIdentity({ workflowRunId: "run-explicit", node: { id: "a" } });
  const retry = createWorkflowNodeIdentity({ workflowRunId: "run-explicit", node: { id: "a" }, attempt: 2 });
  assert.deepEqual(first, again);
  assert.notEqual(first.nodeExecutionId, retry.nodeExecutionId);
  assert.equal(first.commandId, `workflow-node:${first.nodeExecutionId}:send`);
});

test("planning projection follows parsed flowtos and only action dependencies", () => {
  const semantic = parseWorkflowDslText([
    "WORKFLOW_DSL/1",
    'NODE id=start type=state stateType=start name="Start"',
    'NODE id=a type=action name="A" task="A"',
    'NODE id=b type=action name="B" task="B"',
    'NODE id=end type=state stateType=end name="End"',
    "EDGE from=start to=a",
    "EDGE from=a to=b",
    "EDGE from=b to=end",
    "END",
  ].join("\n"));
  const sessions = buildWorkflowPlanningNodeSessions({ workflowRunId: "run-1", semantic });
  const a = sessions.find((item) => item.nodeId === "a");
  const b = sessions.find((item) => item.nodeId === "b");
  assert.equal(a.stepStatus, "ready");
  assert.deepEqual(a.dependencies, []);
  assert.equal(b.stepStatus, "pending");
  assert.deepEqual(b.dependencies, ["a"]);
  assert.equal(a.workflowRunId, "run-1");
  assert.ok(a.nodeExecutionId);
  assert.ok(a.turnScopeId);
});
