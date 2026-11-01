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
import { createAgentTurnResult } from "@noobot/agent-transport-protocol/agent-turn-result";

const options = normalizeOptions({});

function createCtx() {
  return {
    dialogProcessId: "dp-1",
    turnScopeId: "turn-1",
    runConfig: {
      locale: "zh-CN",
      commandId: "cmd-1",
      executionId: "exec-1",
      rootExecutionId: "exec-1",
      presentationMessageId: "pm-1",
    },
    agentContext: {
      bindings: {
        runtime: {
          materializeUnownedCurrentTurnMessageEvents: () => ({
            activityTimeline: [],
            toolTimeline: [],
          }),
        },
      },
    },
  };
}

test("workflow message assigns messageUid and keeps it across phases", async () => {
  const ctx = createCtx();
  const agentResult = createAgentTurnResult({
    output: "",
    traces: [],
    turnMessages: [],
    modelMessages: [],
    modelLoopRound: 0,
  });
  const planning = await appendWorkflowPlanningMessage({
    options,
    ctx,
    agentResult,
    semanticText: "plan",
    workflowPayload: { workflowRunId: "wf-1" },
    nodeTransferEnvelopes: [],
  });
  assert.ok(planning.messageUid);
  const final = await publishWorkflowFinalMessage({
    options,
    ctx,
    agentResult,
    semanticText: "done",
    workflowPayload: { workflowRunId: "wf-1" },
    nodeTransferEnvelopes: [],
  });
  assert.equal(final.messageUid, planning.messageUid);
  assert.equal(agentResult.turnMessages.length, 1);
});

test("existing workflow message without messageUid is rejected", async () => {
  const ctx = createCtx();
  const agentResult = createAgentTurnResult({
    output: "",
    traces: [],
    turnMessages: [],
    modelMessages: [],
    modelLoopRound: 0,
  });
  const planning = await appendWorkflowPlanningMessage({
    options,
    ctx,
    agentResult,
    semanticText: "plan",
    workflowPayload: { workflowRunId: "wf-1" },
    nodeTransferEnvelopes: [],
  });
  delete planning.messageUid;
  await assert.rejects(
    publishWorkflowFinalMessage({
      options,
      ctx,
      agentResult,
      semanticText: "done",
      workflowPayload: { workflowRunId: "wf-1" },
      nodeTransferEnvelopes: [],
    }),
    { code: "AGENT_TURN_RESULT_INVALID" },
  );
});

test("workflow rejects malformed results before materialization or transfer", async () => {
  for (const messages of [undefined, null, {}, [null], [{}], new Array(1)]) {
    const ctx = createCtx();
    const effects = [];
    ctx.agentContext.bindings.runtime.materializeUnownedCurrentTurnMessageEvents = () => {
      effects.push("materialize");
      throw new Error("must not materialize");
    };
    const agentResult = {
      output: "",
      traces: [],
      modelMessages: [],
      modelLoopRound: 0,
      turnMessages: messages,
    };
    const before = structuredClone(agentResult);
    await assert.rejects(
      publishWorkflowFinalMessage({
        options,
        ctx,
        agentResult,
        semanticText: "done",
        workflowPayload: { workflowRunId: "wf-1" },
        nodeTransferEnvelopes: [],
      }),
      { code: "AGENT_TURN_RESULT_INVALID" },
    );
    assert.deepEqual(agentResult, before);
    assert.deepEqual(effects, []);
  }
});
