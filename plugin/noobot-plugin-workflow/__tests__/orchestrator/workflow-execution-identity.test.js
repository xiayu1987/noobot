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
import { normalizeOptions } from "../../src/core/options.js";
import { getWorkflowInstanceSnapshot } from "workflow";
import {
  createSemanticTransferTool,
  installTurnMessageEventRuntimeFixture,
} from "../helpers/workflow-hook-session-strategy-helper.js";

async function runWithPlanning({ options, workflowRunId, planningNodeSessions, ...rest }) {
  const nodeStateSnapshot = await options.workflowNodeStateRepository.initialize({
    workflowRunId,
    planningNodeSessions,
  });
  return runWorkflowExecution({ ...rest, options, workflowRunId, nodeStateSnapshot });
}

function buildSemantic() {
  return parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="Start"',
      'NODE id=a type=action name="A" task="A"',
      'NODE id=end type=state stateType=end name="End"',
      "EDGE from=start to=a",
      "EDGE from=a to=end",
      "END",
    ].join("\n"),
  );
}

function buildCtx() {
  const events = [];
  const ctx = installTurnMessageEventRuntimeFixture({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "d1",
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

function buildOptions({ subSessionRunner, maxAutoTransitions = 3 } = {}) {
  return {
    ...normalizeOptions({ mode: "on", maxAutoTransitions }),
    workflowNodeStateRepository: createInMemoryWorkflowNodeStateRepository(),
    subSessionRunner:
      subSessionRunner ||
      (async ({ strategy, runConfigPatch, metadata }) => ({
        sessionId: strategy.sessionId,
        dialogProcessId: strategy.dialogProcessId,
        strategy,
        runConfigPatch,
        metadata,
        persisted: { outputDir: "runtime/plugin-data/workflow/session/s1/child-a" },
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
        lifecycle: {
          executionId: call.strategy.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: call.strategy.sessionId,
        dialogProcessId: call.strategy.dialogProcessId,
        persisted: { outputDir: "runtime/plugin-data/workflow/session/s1/child-a" },
        result: { messages: [{ role: "assistant", content: "done" }] },
      };
    },
  });
  const result = await runWithPlanning({
    signal: new AbortController().signal,
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
  assert.equal(Object.hasOwn(subSessionCalls[0].strategy, "commandId"), false);
  assert.equal(identity.commandId, identity.turnScopeId);
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
  assert.equal("nodeDialogProcessId" in run, false);
  assert.equal("agentDialogProcessId" in run, false);
  assert.equal(run.nodeSessionId, subSessionCalls[0].strategy.sessionId);

  assert.equal(Array.isArray(realtimeEvents), true);
  const nodeEnvelopes = realtimeEvents
    .filter((item) => item?.event === "authority_event_committed")
    .map((item) => item?.data?.envelope)
    .filter((envelope) => envelope?.identity?.eventType === "workflow_node_state_committed");
  assert.equal(nodeEnvelopes.length, 2);
  assert.equal(nodeEnvelopes[0].identity.sessionId, "s1");
  assert.equal(nodeEnvelopes[0].payload.nodeSessionId, subSessionCalls[0].strategy.sessionId);
  assert.equal(nodeEnvelopes[1].identity.sessionId, "s1");
  assert.equal(nodeEnvelopes[1].payload.nodeSessionId, subSessionCalls[0].strategy.sessionId);
  assert.equal(nodeEnvelopes[1].payload.dialogProcessId, identity.dialogProcessId);
  assert.equal("agentDialogProcessId" in nodeEnvelopes[1].payload, false);
  assert.equal(nodeEnvelopes[1].identity.executionId, identity.nodeExecutionId);
});

test("runWorkflowExecution resolves each node task by nodeId even when node names collide", async () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="Start"',
      'NODE id=a type=action name="Same" task="task of a"',
      'NODE id=b type=action name="Same" task="task of b"',
      'NODE id=end type=state stateType=end name="End"',
      "EDGE from=start to=a",
      "EDGE from=a to=b",
      "EDGE from=b to=end",
      "END",
    ].join("\n"),
  );
  const workflowRunId = "wf_run_same_name";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const { ctx } = buildCtx();
  const messagesByDialog = new Map();
  const options = buildOptions({
    subSessionRunner: async (call) => {
      messagesByDialog.set(call.strategy.dialogProcessId, call.message);
      return {
        lifecycle: {
          executionId: call?.strategy?.executionId || call?.metadata?.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: call.strategy.sessionId,
        dialogProcessId: call.strategy.dialogProcessId,
        persisted: { outputDir: "runtime/plugin-data/workflow/session/s1/child" },
        result: { messages: [{ role: "assistant", content: "done" }] },
      };
    },
  });
  await runWithPlanning({
    signal: new AbortController().signal,
    hookManager: { emit: async () => ({ outcomes: [] }) },
    options,
    ctx,
    semantic,
    workflowRunId,
    planningNodeSessions,
  });

  const identityA = planningNodeSessions.find((item) => item.nodeId === "a");
  const identityB = planningNodeSessions.find((item) => item.nodeId === "b");
  assert.equal(messagesByDialog.get(identityA.dialogProcessId), "task of a");
  assert.equal(messagesByDialog.get(identityB.dialogProcessId), "task of b");
});

test("runWorkflowExecution commits a failed child lifecycle to node state and rejects with the terminal error", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_failure";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const { ctx } = buildCtx();
  const repository = createInMemoryWorkflowNodeStateRepository();
  const options = buildOptions({
    subSessionRunner: async (call) => {
      throw Object.assign(new Error("child crashed"), {
        lifecycle: {
          executionId: call.strategy.executionId,
          executionKind: "agent",
          state: "action_failed",
          revision: 2,
          sequence: 2,
          failure: { code: "CHILD_CRASHED", message: "child crashed" },
        },
      });
    },
  });
  options.workflowNodeStateRepository = repository;
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options,
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions,
    }),
    (error) => error.code === "CHILD_CRASHED",
  );
  const snapshot = await repository.getSnapshot({ workflowRunId });
  const node = snapshot.nodes.find((item) => item.nodeId === "a");
  assert.equal(node.status, "failed");
  assert.deepEqual(node.failure, {
    source: "child_execution",
    code: "CHILD_CRASHED",
    message: "child crashed",
  });
});

test("runWorkflowExecution rejects duplicate planning identities for the same node", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_d1";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const duplicate = planningNodeSessions.find((item) => item.nodeId === "a");
  const { ctx } = buildCtx();
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
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
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({
    workflowRunId,
    semantic,
  }).filter((item) => item.nodeId !== "a");
  const { ctx } = buildCtx();
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
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
  const broken = planningNodeSessions.map((item) =>
    item.nodeId === "a" ? { ...item, commandId: "" } : item,
  );
  const { ctx } = buildCtx();
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
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
      signal: new AbortController().signal,
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options: buildOptions(),
      ctx,
      semantic,
      workflowRunId: "",
    }),
    /workflowRunId is required/,
  );
});

test("runWorkflowExecution rejects planning identity without nodeName", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_d1";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const broken = planningNodeSessions.map((item) =>
    item.nodeId === "a" ? { ...item, nodeName: "" } : item,
  );
  const { ctx } = buildCtx();
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options: buildOptions(),
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions: broken,
    }),
    /incomplete workflow node identity\/state: nodeName/,
  );
});

test("runWorkflowExecution commits FAILED with a boundary code when a child throws a bare error", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_bare_error";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const { ctx } = buildCtx();
  const repository = createInMemoryWorkflowNodeStateRepository();
  const options = buildOptions({
    subSessionRunner: async () => {
      throw new Error("bare failure");
    },
  });
  options.workflowNodeStateRepository = repository;
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options,
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions,
    }),
    /bare failure/,
  );
  const snapshot = await repository.getSnapshot({ workflowRunId });
  const node = snapshot.nodes.find((item) => item.nodeId === "a");
  assert.equal(node.status, "failed");
  assert.deepEqual(node.failure, {
    source: "workflow_node_agent",
    code: "WORKFLOW_NODE_EXECUTION_FAILED",
    message: "bare failure",
  });
});

test("runWorkflowExecution commits FAILED when the child terminal receipt is rejected", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_receipt_rejected";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const { ctx } = buildCtx();
  const repository = createInMemoryWorkflowNodeStateRepository();
  const options = buildOptions({
    subSessionRunner: async () => {
      throw Object.assign(new Error("child crashed"), {
        lifecycle: {
          executionId: "agent:old-attempt",
          executionKind: "agent",
          state: "action_failed",
          revision: 2,
          sequence: 2,
          failure: { code: "CHILD_CRASHED", message: "child crashed" },
        },
      });
    },
  });
  options.workflowNodeStateRepository = repository;
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options,
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions,
    }),
    (error) => error.code === "WORKFLOW_CHILD_TERMINAL_RECEIPT_INVALID",
  );
  const snapshot = await repository.getSnapshot({ workflowRunId });
  const node = snapshot.nodes.find((item) => item.nodeId === "a");
  assert.equal(node.status, "failed");
  assert.deepEqual(node.failure, {
    source: "workflow",
    code: "WORKFLOW_CHILD_TERMINAL_RECEIPT_INVALID",
    message: "invalid child execution terminal receipt: execution_identity_mismatch",
  });
});

test("runWorkflowExecution propagates a terminal commit failure without a second failure commit", async () => {
  const semantic = buildSemantic();
  const workflowRunId = "wf_run_terminal_commit_failure";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const { ctx } = buildCtx();
  const options = buildOptions({
    subSessionRunner: async (call) => ({
      lifecycle: {
        executionId: call.strategy.executionId,
        executionKind: "agent",
        state: "completed",
        revision: 4,
        sequence: 4,
      },
      sessionId: call.strategy.sessionId,
      dialogProcessId: call.strategy.dialogProcessId,
      result: { messages: [{ role: "assistant", content: "done" }] },
    }),
  });
  const repository = options.workflowNodeStateRepository;
  const commits = [];
  const commit = repository.commit.bind(repository);
  repository.commit = async (transition) => {
    commits.push(transition.status);
    if (transition.status === "succeeded") throw new Error("terminal commit conflict");
    return commit(transition);
  };
  await assert.rejects(
    runWithPlanning({
      signal: new AbortController().signal,
      hookManager: { emit: async () => ({ outcomes: [] }) },
      options,
      ctx,
      semantic,
      workflowRunId,
      planningNodeSessions,
    }),
    /terminal commit conflict/,
  );
  assert.deepEqual(commits.slice(0, 2), ["running", "succeeded"]);
  assert.equal(commits.includes("failed"), false);
  const snapshot = await repository.getSnapshot({ workflowRunId });
  assert.equal(snapshot.nodes.find((item) => item.nodeId === "a").status, "running");
});

test("runWorkflowExecution releases the runtime instance when the transition limit is reached", async () => {
  const semantic = parseWorkflowDslText(
    [
      "WORKFLOW_DSL/1",
      'NODE id=start type=state stateType=start name="Start"',
      'NODE id=a type=action name="A" task="A"',
      'NODE id=b type=action name="B" task="B"',
      'NODE id=end type=state stateType=end name="End"',
      "EDGE from=start to=a",
      "EDGE from=a to=b",
      "EDGE from=b to=end",
      "END",
    ].join("\n"),
  );
  const workflowRunId = "wf_run_limit";
  const planningNodeSessions = buildWorkflowPlanningNodeSessions({ workflowRunId, semantic });
  const { ctx } = buildCtx();
  const result = await runWithPlanning({
    signal: new AbortController().signal,
    hookManager: { emit: async () => ({ outcomes: [] }) },
    options: buildOptions({
      maxAutoTransitions: 1,
      subSessionRunner: async (call) => ({
        lifecycle: {
          executionId: call.strategy.executionId,
          executionKind: "agent",
          state: "completed",
          revision: 4,
          sequence: 4,
        },
        sessionId: call.strategy.sessionId,
        dialogProcessId: call.strategy.dialogProcessId,
        persisted: { outputDir: "runtime/plugin-data/workflow/session/s1/child-limit" },
        result: { messages: [{ role: "assistant", content: "done" }] },
      }),
    }),
    ctx,
    semantic,
    workflowRunId,
    planningNodeSessions,
  });
  assert.equal(result.execution.completed, false);
  assert.equal(result.execution.autoTransitions, 1);
  assert.throws(
    () => getWorkflowInstanceSnapshot({ instanceId: workflowRunId }),
    /workflow instance not found/,
  );
});
