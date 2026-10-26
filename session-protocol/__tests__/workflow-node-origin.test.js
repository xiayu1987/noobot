/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORKFLOW_NODE_ORIGIN_TYPE,
  createWorkflowNodeOrigin,
  projectWorkflowNodeOwnership,
} from "@noobot/session-protocol/execution-lifecycle";

const nodeOrigin = { workflowRunId: "workflow:run-1", nodeExecutionId: "node-exec-1" };

test("workflow node origin projects the single node ownership pair", () => {
  const origin = createWorkflowNodeOrigin(nodeOrigin);
  assert.deepEqual(origin, { type: WORKFLOW_NODE_ORIGIN_TYPE, ...nodeOrigin });
  assert.deepEqual(projectWorkflowNodeOwnership(origin), {
    workflowRunId: "workflow:run-1",
    nodeExecutionId: "node-exec-1",
  });
});

test("non-node origins carry no node ownership", () => {
  assert.equal(projectWorkflowNodeOwnership({}), null);
  assert.equal(
    projectWorkflowNodeOwnership({ type: "workflow", workflowRunId: "workflow:run-1" }),
    null,
  );
});

test("incomplete or non-canonical workflow node origins are rejected", () => {
  for (const patch of [
    { workflowRunId: undefined },
    { nodeExecutionId: "" },
    { workflowRunId: " workflow:run-1" },
    { nodeExecutionId: 7 },
  ]) {
    const input = { ...nodeOrigin, ...patch };
    assert.throws(() => createWorkflowNodeOrigin(input), { code: "EXECUTION_ORIGIN_INVALID" });
    assert.throws(
      () => projectWorkflowNodeOwnership({ type: WORKFLOW_NODE_ORIGIN_TYPE, ...input }),
      { code: "EXECUTION_ORIGIN_INVALID" },
    );
  }
  for (const origin of [null, undefined, "workflow_node", []]) {
    assert.throws(() => projectWorkflowNodeOwnership(origin), { code: "EXECUTION_ORIGIN_INVALID" });
  }
});
