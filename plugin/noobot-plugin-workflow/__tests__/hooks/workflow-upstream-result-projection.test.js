/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkflowUpstreamAttachmentResults } from "../../src/core/hooks/node-upstream-messages.js";
import { createV2AttachmentTransferEnvelope } from "../helpers/workflow-hook-session-strategy-helper.js";

function upstreamStep(stepId) {
  return {
    nodeId: `node-${stepId}`,
    nodeName: `Node ${stepId}`,
    actionNodeStateId: `ans-${stepId}`,
    stepId,
    stepIndex: 0,
  };
}

function completedResult(stepId, transferEnvelopes) {
  return {
    transition: 2,
    nodeTask: `task ${stepId}`,
    nodeSessionId: `session-${stepId}`,
    transferEnvelopes,
  };
}

test("upstream projection skips steps that have not completed", () => {
  const results = buildWorkflowUpstreamAttachmentResults({
    upstreamActionSteps: [upstreamStep("pending")],
    completedStepResults: new Map(),
  });
  assert.deepEqual(results, []);
});

test("upstream projection skips completed steps without attachment envelopes", () => {
  const results = buildWorkflowUpstreamAttachmentResults({
    upstreamActionSteps: [upstreamStep("done")],
    completedStepResults: new Map([["done", completedResult("done", [])]]),
  });
  assert.deepEqual(results, []);
});

test("upstream projection takes structure from the runtime step and execution facts from the completed result", () => {
  const envelope = createV2AttachmentTransferEnvelope({ attachmentId: "att-up" });
  const [result] = buildWorkflowUpstreamAttachmentResults({
    upstreamActionSteps: [upstreamStep("done")],
    completedStepResults: new Map([["done", completedResult("done", [envelope])]]),
  });
  assert.deepEqual(result, {
    nodeId: "node-done",
    nodeName: "Node done",
    nodeTask: "task done",
    actionNodeStateId: "ans-done",
    stepId: "done",
    stepIndex: 0,
    transition: 2,
    nodeSessionId: "session-done",
    transferEnvelopes: [envelope],
  });
});
