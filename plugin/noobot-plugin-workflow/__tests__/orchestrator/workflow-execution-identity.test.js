/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseWorkflowDslText } from "../../src/protocol/text-protocol.js";
import { runWorkflowExecution } from "../../src/core/orchestrator/execution-runner.js";
import { createInMemoryWorkflowNodeStateRepository } from "../../src/core/orchestrator/node-state-repository.js";
import { buildWorkflowPlanningNodeSessions } from "../../src/core/workflow-run-identity.js";
import {
  createSemanticTransferTool,
  installTurnMessageEventRuntimeFixture,
} from "../helpers/workflow-hook-session-strategy-helper.js";

function buildSemantic() {
  return parseWorkflowDslText([
    "WORKFLOW_DSL/1",
    'NODE id=start type=state stateType=start name="Start"',
    'NODE id=a type=action name="A" task="A"',
    'NODE id=end type=state stateType=end name="End"',
    "EDGE from=start to=a",
    "EDGE from=a to=end",
    "END",
  ].join("\n"));
}

function buildCtx() {
  const events = [];
  const ctx = installTurnMessageEventRuntimeFixture({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
    turnScopeId: "turn-workflow-test",
    runConfig: { streaming: false, turnScopeId: "turn-workflow-test" },
    eventListener: {
      onEvent(event) {
        events.push(event);
      },
    },
    agentContext: {
      bindings: {
        runtime: {
          sharedTools: {
            semanticTransfer: createSemanticTransferTool(),
          },
        },
      },
    },
  });
  return {
    ctx,
    events,
  };
}

function buildOptions({ subSessionRunner } = {}) {
  return {
    maxAutoTransitions: 3,
    workflowNodeStateRepository: createInMemoryWorkflowNodeStateRepository(),
    subSessionRunner: subSessionRunner || (async ({ strategy, runConfigPatch, metadata }) => ({
      sessionId: "child-a",
      dialogProcessId: strategy.dialogProcessId,
      strategy,
      runConfigPatch,
      metadata,
      persisted: { outputDir: "runtime/workflow/session/s1/child-a" },
      result: { messages: [{ role: "assistant", content: "done" }] },
    })),
  };
}

test("runWorkflowExecution carries planning identity through events, strategy and payload", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_d1";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const { ctx, events: realtimeEvents } = buildCtx();
  const subSessionCalls = [];
  const options = buildOptions({
      subSessionRunner: async (call) => {
        subSessionCalls.push(call);
        return {
          lifecycle: { executionId: call?.strategy?.executionId || call?.metadata?.executionId, executionKind: "agent", state: "completed", revision: 4, sequence: 4 },
          sessionId: "child-a",
          dialogProcessId: "actual-child-dialog-a",
          persisted: { outputDir: "runtime/workflow/session/s1/child-a" },
          result: { messages: [{ role: "assistant", content: "done" }] },
        };
      },
    });
  const result = await runWorkflowExecution({
    hookManager: { emit: async () => ({ outcomes: [] }) },
    options,
    ctx,
    semantic,
    workflowRunId,
    planningNodeSessions,
  });

  const identity = planningNodeSessions.find((item) => item.nodeId === "a");
  assert.ok(identity);
  assert.equal(subSessionCalls.length, 1);
  assert.equal(subSessionCalls[0].strategy.commandId, identity.commandId);
  assert.equal(subSessionCalls[0].strategy.dialogProcessId, identity.dialogProcessId);
  assert.equal(subSessionCalls[0].strategy.turnScopeId, identity.turnScopeId);
  assert.ok(subSessionCalls[0].strategy.sessionId);
  assert.equal(subSessionCalls[0].runConfigPatch.workflowNodeExecutionId, identity.nodeExecutionId);
  assert.equal(subSessionCalls[0].metadata.nodeExecutionId, identity.nodeExecutionId);

  const run = result.execution.nodeAgentRuns[0];
  assert.equal(run.workflowRunId, identity.workflowRunId);
  assert.equal(run.nodeExecutionId, identity.nodeExecutionId);
  assert.equal(run.commandId, identity.commandId);
  assert.equal(run.turnScopeId, identity.turnScopeId);
  assert.equal(run.nodeDialogProcessId, identity.dialogProcessId);
  assert.equal(run.agentDialogProcessId, "actual-child-dialog-a");
  assert.equal(run.nodeSessionId, "child-a");

  assert.equal(Array.isArray(realtimeEvents), true);
  const nodeEnvelopes = realtimeEvents
    .filter((item) => item?.event === "authority_event_committed")
    .map((item) => item?.data?.envelope)
    .filter((envelope) => envelope?.identity?.eventType === "workflow_node_state_committed");
  assert.equal(nodeEnvelopes.length, 2);
  assert.equal(nodeEnvelopes[0].identity.sessionId, "s1");
  assert.equal(nodeEnvelopes[0].payload.nodeSessionId, subSessionCalls[0].strategy.sessionId);
  assert.equal(nodeEnvelopes[1].identity.sessionId, "s1");
  assert.equal(nodeEnvelopes[1].payload.nodeSessionId, "child-a");
  assert.equal(nodeEnvelopes[1].payload.dialogProcessId, identity.dialogProcessId);
  assert.equal(nodeEnvelopes[1].payload.agentDialogProcessId, "actual-child-dialog-a");
  assert.equal(nodeEnvelopes[1].identity.executionId, identity.nodeExecutionId);
});

test("runWorkflowExecution rejects duplicate planning identities for the same node attempt", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_d1";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const duplicate = planningNodeSessions.find((item) => item.nodeId === "a");
  const { ctx } = buildCtx();
  await assert.rejects(
    runWorkflowExecution({
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options: buildOptions(),
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions: [...planningNodeSessions, { ...duplicate }],
    }),
    /duplicate workflow node identity/,
  );
});

test("runWorkflowExecution rejects missing planning identity in new protocol path", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_d1";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic })
    .filter((item) => item.nodeId !== "a");
  const { ctx } = buildCtx();
  await assert.rejects(
    runWorkflowExecution({
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options: buildOptions(),
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions,
    }),
    /missing workflow node identity/,
  );
});

test("runWorkflowExecution rejects incomplete planning identity", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_d1";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const broken = planningNodeSessions.map((item) => item.nodeId === "a" ? { ...item, commandId: "" } : item);
  const { ctx } = buildCtx();
  await assert.rejects(
    runWorkflowExecution({
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options: buildOptions(),
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions: broken,
    }),
    /incomplete workflow node identity/,
  );
});

test("runWorkflowExecution rejects missing workflow and planning identities", async () => {
  const semantic = buildSemantic();
  const { ctx } = buildCtx();
  await assert.rejects(
    runWorkflowExecution({
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options: buildOptions(),
      ctx,
      semantic,
      workflowRunId: "",
      planningNodeSessions: [],
    }),
    /workflowRunId is required/,
  );
});
