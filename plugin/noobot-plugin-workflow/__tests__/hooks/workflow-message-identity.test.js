/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendWorkflowPlanningMessage,
  publishWorkflowFinalMessage,
} from "../../src/core/hooks/persistence.js";
import { normalizeOptions } from "../../src/core/options.js";

const options = normalizeOptions({});

function createCtx() {
  return {
    dialogProcessId: "dp-1",
    runConfig: {
      turnScopeId: "turn-1",
      commandId: "cmd-1",
      executionId: "exec-1",
      rootExecutionId: "exec-1",
      presentationMessageId: "pm-1",
    },
    agentContext: {
      bindings: { runtime: { materializeUnownedCurrentTurnMessageEvents: () => ({}) } },
    },
  };
}

test("workflow message assigns messageUid and keeps it across phases", async () => {
  const ctx = createCtx();
  const agentResult = {};
  const planning = await appendWorkflowPlanningMessage({
    options,
    ctx,
    agentResult,
    semanticText: "plan",
  });
  assert.ok(planning.messageUid);
  const final = await publishWorkflowFinalMessage({
    options,
    ctx,
    agentResult,
    semanticText: "done",
  });
  assert.equal(final.messageUid, planning.messageUid);
  assert.equal(agentResult.turnMessages.length, 1);
});

test("existing workflow message without messageUid is rejected", async () => {
  const ctx = createCtx();
  const agentResult = {};
  const planning = await appendWorkflowPlanningMessage({
    options,
    ctx,
    agentResult,
    semanticText: "plan",
  });
  delete planning.messageUid;
  await assert.rejects(
    publishWorkflowFinalMessage({ options, ctx, agentResult, semanticText: "done" }),
    /Existing workflow message requires a messageUid/,
  );
});
