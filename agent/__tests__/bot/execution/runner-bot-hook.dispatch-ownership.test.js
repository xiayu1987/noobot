/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createTestRuntimeContext } from "../../helpers/test-runtime-context.js";
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
import { stubModelTransport } from "../../helpers/test-model-config.js";
import { createConfigSnapshot } from "@noobot/agent-config-protocol";
import { BOT_DISPATCH_ROOT_OWNER } from "@noobot/agent-transport-protocol/bot-dispatch";
import { projectAgentContextIdentity } from "../../../src/context/agent-context-envelope-input.js";

function workflowRunIdentity(workflowRunId) {
  const executionId = `workflow:${workflowRunId}`;
  return {
    executionId,
    executionKind: "workflow",
    rootExecutionId: executionId,
    origin: { type: "workflow", workflowRunId },
    stage: "planning",
  };
}

test("before-dispatch capability events use the bound Turn message domain", async (t) => {
  const botHookManager = createTestBotHookManager();
  const events = [];
  const capabilityModelInvoker = createAgentCapabilityModelInvoker({
    enableToolBinding: false,
    pluginId: "noobot-plugin-test",
    configSnapshot: createConfigSnapshot(),
  });
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, async (ctx, invocation) => {
    await capabilityModelInvoker({
      purpose: "workflow_semantic",
      activity: { activityKind: "workflow_semantic" },
      domain: "workflow",
      ctx,
      signal: invocation.signal,
    });
  });
  const runner = createRunner({
    botHookManager,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      const { runtimeIdentity, runConfig: acceptedRunConfig } = buildContextPayload;

      const invocationIdentity = projectAgentContextIdentity(
        { ...runtimeIdentity, rootSessionId: runtimeIdentity.sessionId },
        acceptedRunConfig,
      );
      const runtimeAgentContext = createTestAgentExecutionScope(
        Object.assign(createTestRuntimeContext({ identity: runtimeIdentity }), {
          eventListener: buildContextPayload.eventListener,
        }),
        { identity: invocationIdentity },
      );
      return { agentContext: runtimeAgentContext, userMessageAttachments: [] };
    },
  });

  const restoreFetch = stubModelTransport("WORKFLOW_DSL/1\nEND");
  t.after(restoreFetch);
  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    message: "build workflow",
    turnScopeId: "turn-workflow-semantic",
    runConfig: {
      presentationMessageId: "presentation-workflow-semantic",
    },
    eventListener: { onEvent: (event) => events.push(event) },
  });

  const committedEvent = events.find(
    (item = {}) =>
      item.event === "authority_event_committed" &&
      item?.data?.envelope?.payload?.eventType === "thinking" &&
      item?.data?.envelope?.payload?.activityKind === "workflow_semantic",
  );
  const envelope = committedEvent?.data?.envelope;
  assert.equal(envelope?.payload?.presentationMessageId, "presentation-workflow-semantic");
  assert.equal(envelope?.ordering?.sequence, 2);
  assert.equal(envelope?.protocol?.version, 3);
  assert.equal(envelope?.ordering?.domain, "message-event");
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
      result: createCanonicalHandledResult("hook result"),
    });
  });
  const runner = createRunner({ botHookManager });
  const runPromise = runner.runAcceptedSession({
    turnScopeId: "turn-default",
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
    assert.equal(ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_takeover" }), true);
    assert.equal(
      ctx.claimAgentDispatch({ owner: BOT_DISPATCH_ROOT_OWNER, source: "conflicting_takeover" }),
      false,
    );
    return createBotDispatchHandled({
      owner: "workflow",
      result: createCanonicalHandledResult("hook result"),
    });
  });
  const runner = createRunner({ botHookManager });
  await runner.runAcceptedSession({
    turnScopeId: "turn-default",
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: workflowRunIdentity("wf-1"),
    eventListener: {
      onEvent(event = {}) {
        if (event.event === "agent_lifecycle_state_changed" && event.data?.state === "running") {
          lifecycleStates.push(event.data);
        }
      },
    },
  });

  assert.equal(lifecycleStates.length, 1);
  assert.equal(lifecycleStates[0].executionOwner, "workflow");
  assert.equal(lifecycleStates[0].source, "workflow_takeover");
  assert.equal(lifecycleStates[0].executionId, "workflow:wf-1");
  assert.equal(lifecycleStates[0].executionKind, "workflow");
  assert.equal(lifecycleStates[0].stage, "planning");
  assert.deepEqual(lifecycleStates[0].origin, { type: "workflow", workflowRunId: "wf-1" });
});

test("structured dispatch outcome routes exclusively to the workflow owner", async () => {
  const botHookManager = createTestBotHookManager();
  const events = [];
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_router" });
    return createBotDispatchHandled({
      owner: "workflow",
      result: createCanonicalHandledResult("workflow result"),
    });
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return createCanonicalHandledResult("wrong");
    },
  });

  await runner.runAcceptedSession({
    turnScopeId: "turn-default",
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
    failureCode: null,
  });
});

test("a handled workflow failure terminates the root Turn without Agent fallback", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_router" });
    return createBotDispatchHandled({
      owner: "workflow",
      failure: { code: "WORKFLOW_NODE_FAILED", message: "node failed" },
    });
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return createCanonicalHandledResult("wrong");
    },
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "workflow task",
        runConfig: {},
      }),
    (error) => error?.code === "WORKFLOW_NODE_FAILED" && error?.cause?.dispatchOwner === "workflow",
  );
  assert.equal(rootAgentCalls, 0);
});

test("a claimed dispatch hook failure cannot fall back to the root Agent", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_router" });
    throw new Error("workflow owner failed");
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return createCanonicalHandledResult("wrong");
    },
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "workflow task",
        runConfig: {},
      }),
    /workflow owner failed/,
  );
  assert.equal(rootAgentCalls, 0);
});

test("a claimed dispatch cannot pass the same task back to the root Agent", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_router" });
    return undefined;
  });
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return createCanonicalHandledResult("wrong");
    },
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "workflow task",
        runConfig: {},
      }),
    (error) => error?.code === "BOT_DISPATCH_CLAIM_RELEASE_FORBIDDEN",
  );
  assert.equal(rootAgentCalls, 0);
});

test("a structured dispatch takeover must claim ownership before returning handled", async () => {
  const botHookManager = createTestBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, () =>
    createBotDispatchHandled({ owner: "workflow", result: createCanonicalHandledResult("done") }),
  );
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return createCanonicalHandledResult("wrong");
    },
  });

  await assert.rejects(
    () =>
      runner.runAcceptedSession({
        turnScopeId: "turn-default",
        userId: "u1",
        sessionId: "s1",
        message: "workflow task",
        runConfig: {},
      }),
    (error) => error?.code === "BOT_DISPATCH_CLAIM_REQUIRED",
  );
  assert.equal(rootAgentCalls, 0);
});
