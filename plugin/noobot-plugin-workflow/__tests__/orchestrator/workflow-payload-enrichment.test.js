/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { enrichWorkflowPayload } from "../../src/core/orchestrator/payload-enrichment.js";

function nodeState(nodeExecutionId, status) {
  return {
    workflowRunId: "run-1",
    nodeExecutionId,
    nodeId: nodeExecutionId,
    nodeName: nodeExecutionId,
    nodeSessionId: `session-${nodeExecutionId}`,
    status,
  };
}

test("enrichWorkflowPayload projects every snapshot node and joins runs by nodeExecutionId", () => {
  const { workflowPayload } = enrichWorkflowPayload({
    workflowPayload: {},
    nodeStateSnapshot: { nodes: [nodeState("a", "succeeded"), nodeState("b", "skipped")] },
    nodeAgentRuns: [
      {
        nodeExecutionId: "a",
        transition: 1,
        stepId: "step-a",
        stepIndex: 0,
        parallelWave: 0,
        nodeResultTransferEnvelopes: [],
      },
    ],
  });

  assert.deepEqual(
    workflowPayload.nodeSessions.map((item) => [item.nodeExecutionId, item.status]),
    [
      ["a", "succeeded"],
      ["b", "skipped"],
    ],
  );
  assert.equal(workflowPayload.nodeSessions[0].stepId, "step-a");
  assert.equal(workflowPayload.nodeSessions[0].nodeSessionId, "session-a");
  assert.equal(Object.hasOwn(workflowPayload.nodeSessions[1], "stepId"), false);
  assert.equal(Object.hasOwn(workflowPayload.nodeSessions[1], "transition"), false);
});

test("enrichWorkflowPayload rejects duplicate runs for one nodeExecutionId", () => {
  assert.throws(
    () =>
      enrichWorkflowPayload({
        workflowPayload: {},
        nodeStateSnapshot: { nodes: [nodeState("a", "succeeded")] },
        nodeAgentRuns: [{ nodeExecutionId: "a" }, { nodeExecutionId: "a" }],
      }),
    /duplicate workflow node run: a/,
  );
});
