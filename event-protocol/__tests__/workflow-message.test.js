/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  isWorkflowMessage,
  WORKFLOW_MESSAGE_IDENTITY,
  WORKFLOW_MESSAGE_PHASE,
  requireWorkflowMessagePhase,
} from "../src/workflow-runtime-event.js";

function message(phase = "planning") {
  return {
    type: WORKFLOW_MESSAGE_IDENTITY.type,
    pluginMeta: {
      source: WORKFLOW_MESSAGE_IDENTITY.source,
      kind: WORKFLOW_MESSAGE_IDENTITY.kind,
      phase,
    },
  };
}

test("workflow identity is shared by persisted and live messages without inspecting plugin payload", () => {
  for (const phase of Object.values(WORKFLOW_MESSAGE_PHASE)) {
    const value = Object.freeze(message(phase));
    assert.equal(isWorkflowMessage(value), true);
    assert.equal(requireWorkflowMessagePhase(phase), phase);
  }
});

test("workflow identity cannot be inferred from a type, derived flag or private payload", () => {
  for (const value of [
    undefined,
    null,
    {},
    { type: "workflow" },
    { workflowMessage: true },
    { pluginMeta: { payload: { workflowRunId: "workflow-a" } } },
  ]) {
    assert.equal(isWorkflowMessage(value), false);
  }
  for (const field of ["source", "kind", "phase"]) {
    for (const value of [undefined, "", " planning ", 1]) {
      const candidate = message();
      candidate.pluginMeta[field] = value;
      assert.equal(isWorkflowMessage(candidate), false);
    }
  }
  assert.equal(isWorkflowMessage({ ...message(), type: "Workflow" }), false);
});

test("workflow producers and consumers use the same closed phase contract without cleaning", () => {
  for (const phase of [undefined, null, "", "running", "failed", " planning ", 1]) {
    const candidate = message();
    candidate.pluginMeta.phase = phase;
    assert.equal(isWorkflowMessage(candidate), false);
    assert.throws(() => requireWorkflowMessagePhase(phase), /invalid_workflow_message_phase/);
  }
});
