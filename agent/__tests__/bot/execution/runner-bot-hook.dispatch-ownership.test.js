/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createRunner,
  createTestBotHookManager,
  createCanonicalHandledResult,
  HOOK_POINT,
  createAgentCapabilityModelInvoker,
  createBotDispatchHandled,
  createTestAgentExecutionScope,
} from "./runner-bot-hook.fixtures.js";
import { createModelResponse } from "@noobot/model-protocol";

function createCompletedModelResponse(request, text) {
  const output = {
    text,
    reasoning: "",
    toolCalls: [],
    finishReason: "stop",
    usage: {},
  };
  return createModelResponse({
    invocation: {
      ...request.invocation,
      requestId: "request-before-dispatch",
      invocationId: "invocation-before-dispatch",
      sessionId: "s1",
      parentSessionId: "",
      dialogProcessId: "dp1",
      turnScopeId: "turn-workflow-semantic",
      runId: "agent:turn-workflow-semantic",
    },
    output,
    attempts: [
      {
        attempt: 1,
        status: "completed",
        kind: "response",
        streaming: false,
        output,
      },
    ],
    model: request.model,
    provider: {},
  });
}

test("before-dispatch capability events use the bound Turn message domain", async () => {
  const botHookManager = createTestBotHookManager();
  const events = [];
  const capabilityModelInvoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
  });
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, async (ctx = {}) => {
    await capabilityModelInvoker({
      purpose: "workflow_semantic",
      domain: "workflow",
      ctx,
    });
  });
  const runner = createRunner({
    botHookManager,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      const turnScopeId = buildContextPayload.runConfig.turnScopeId;
      const invocationIdentity = {
        sessionId: buildContextPayload.sessionId,
        parentSessionId: buildContextPayload.parentSessionId || "",
        dialogProcessId: buildContextPayload.dialogProcessId,
        turnScopeId,
        runId: `agent:${turnScopeId}`,
      };
      const modelPort = {
        async invoke(request) {
          return createCompletedModelResponse(request, "WORKFLOW_DSL/1\nEND");
        },
      };
      const runtimeAgentContext = createTestAgentExecutionScope({
        attachmentMetas: [],
        eventListener: buildContextPayload.eventListener,
        modelHost: {
          modelSpec: { alias: "test", model: "test", format: "openai_compatible" },
          modelPort,
          modelState: {},
          invocationIdentity,
        },
        modelPort,
      }, { identity: invocationIdentity });
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "build workflow",
    turnScopeId: "turn-workflow-semantic",
    runConfig: {
      messageId: "message-workflow-semantic",
      presentationMessageId: "presentation-workflow-semantic",
    },
    eventListener: { onEvent: (event) => events.push(event) },
  });

  const thinkingEvent = events.find(
    (item = {}) => item.event === "thinking" && item?.data?.event === "workflow_semantic_response",
  );
  assert.equal(thinkingEvent?.data?.messageId, "message-workflow-semantic");
  assert.equal(thinkingEvent?.data?.presentationMessageId, "presentation-workflow-semantic");
  assert.equal(thinkingEvent?.data?.sequence, 1);
  assert.equal(thinkingEvent?.data?.envelopeKind, "noobot.message_event");
  assert.equal(thinkingEvent?.data?.sequenceDomain, "message-event");
});

test("before-dispatch takeover can claim root processing before the hook completes", async () => {
  const botHookManager = createTestBotHookManager();
  const lifecycleStates = [];
  let releaseHook;
  const hookGate = new Promise((resolve) => {
    releaseHook = resolve;
  });
  let claimedInsideHook = false;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, async (ctx = {}) => {
    claimedInsideHook = ctx.claimAgentDispatch({ owner: "test_takeover", source: "test_takeover" });
    await hookGate;
    return createBotDispatchHandled({
      owner: "test_takeover",
      result: createCanonicalHandledResult(ctx, "hook result"),
    });
  });
  const runner = createRunner({ botHookManager });
  const runPromise = runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
    eventListener: {
      onEvent(event = {}) {
        if (event.event === "agent_lifecycle_state_changed") lifecycleStates.push(event.data);
      },
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(claimedInsideHook, true);
  assert.equal(lifecycleStates.filter((item) => item.state === "running").length, 1);
  assert.equal(lifecycleStates.find((item) => item.state === "running")?.source, "test_takeover");
  releaseHook();
  await runPromise;
  assert.equal(lifecycleStates.filter((item) => item.state === "running").length, 1);
});

test("before-dispatch takeover publishes immutable execution ownership metadata once", async () => {
  const botHookManager = createTestBotHookManager();
  const lifecycleStates = [];
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, async (ctx = {}) => {
    assert.equal(
      ctx.claimAgentDispatch({
        owner: "workflow",
        source: "workflow_takeover",
        executionKind: "workflow",
        origin: { type: "workflow", workflowRunId: "wf-1" },
        stage: "planning",
      }),
      true,
    );
    assert.equal(
      ctx.claimAgentDispatch({
        source: "conflicting_takeover",
        executionKind: "agent",
        origin: { type: "chat" },
      }),
      false,
    );
    return createBotDispatchHandled({
      owner: "workflow",
      result: createCanonicalHandledResult(ctx, "hook result"),
    });
  });
  const runner = createRunner({ botHookManager });
  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
    eventListener: {
      onEvent(event = {}) {
        if (event.event === "agent_lifecycle_state_changed" && event.data?.state === "running") {
          lifecycleStates.push(event.data);
        }
      },
    },
  });

  assert.equal(lifecycleStates.length, 1);
  assert.equal(lifecycleStates[0].executionKind, "workflow");
  assert.equal(lifecycleStates[0].stage, "planning");
  assert.deepEqual(lifecycleStates[0].origin, { type: "workflow", workflowRunId: "wf-1" });
});

test("structured dispatch outcome routes exclusively to the workflow owner", async () => {
  const botHookManager = createTestBotHookManager();
  const events = [];
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({
      owner: "workflow",
      source: "workflow_router",
      executionKind: "workflow",
      origin: { type: "workflow", workflowRunId: "wf-structured" },
      stage: "planning",
    });
    return createBotDispatchHandled({
      owner: "workflow",
      result: createCanonicalHandledResult(ctx, "workflow result"),
    });
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return { output: "wrong", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "workflow task",
    runConfig: {},
    eventListener: { onEvent: (event) => events.push(event) },
  });

  assert.equal(rootAgentCalls, 0);
  assert.deepEqual(events.find((event) => event?.event === "bot_dispatch_routed")?.data, {
    disposition: "handled",
    owner: "workflow",
    claimed: true,
    claimedSource: "workflow_router",
    executionKind: "workflow",
    stage: "planning",
    failureCode: "",
  });
});

test("a handled workflow failure terminates the root Turn without Agent fallback", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({
      owner: "workflow",
      source: "workflow_router",
      executionKind: "workflow",
    });
    return createBotDispatchHandled({
      owner: "workflow",
      failure: { code: "WORKFLOW_NODE_FAILED", message: "node failed" },
    });
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return { output: "wrong", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    (error) => error?.code === "WORKFLOW_NODE_FAILED" && error?.dispatchOwner === "workflow",
  );
  assert.equal(rootAgentCalls, 0);
});

test("a claimed dispatch hook failure cannot fall back to the root Agent", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({ source: "workflow_router", executionKind: "workflow" });
    throw new Error("workflow owner failed");
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return { output: "wrong", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    /workflow owner failed/,
  );
  assert.equal(rootAgentCalls, 0);
});

test("a claimed dispatch cannot pass the same task back to the root Agent", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({
      owner: "workflow",
      source: "workflow_router",
      executionKind: "workflow",
    });
    return undefined;
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return { output: "wrong", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    (error) => error?.code === "BOT_DISPATCH_CLAIM_RELEASE_FORBIDDEN",
  );
  assert.equal(rootAgentCalls, 0);
});

test("a structured dispatch takeover must claim ownership before returning handled", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, () =>
    createBotDispatchHandled({ owner: "workflow", result: { output: "done" } }),
  );
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return { output: "wrong", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    (error) => error?.code === "BOT_DISPATCH_CLAIM_REQUIRED",
  );
  assert.equal(rootAgentCalls, 0);
});

