/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionExecutionRunner } from "../../../src/bot/execution/runner.js";
import {
  BOT_HOOK_POINTS,
  createBotHookManager,
} from "../../../src/bot/hook/index.js";
import { warnAgentContextCompatFieldOnce } from "../../../src/context/compatibility-deprecation.js";
import { createBotDispatchHandled } from "@noobot/shared/bot-dispatch-protocol";

function createRunner({
  botHookManager = createBotHookManager(),
  agentRunner = async () => ({
    output: "ok",
    traces: [],
    turnMessages: [],
    turnTasks: [],
  }),
  prepareAgentTurnExecution = async () => ({
    agentContext: {
      execution: { controllers: { runtime: { attachmentMetas: [] } } },
    },
    runtimeAgentContext: {
      execution: { controllers: { runtime: { attachmentMetas: [] } } },
    },
  }),
  initializeRunSessionRuntime = async ({ eventListener = null } = {}) => ({
    usedSessionId: "s1",
    dialogProcessId: "dp1",
    sessionLoadState: "created",
    userConfig: {},
    currentSessionModelAlias: "",
    executionStartIndex: 0,
    runtimeEventListener: eventListener,
  }),
  resolveScenarioRunConfig = (runConfig = {}) => runConfig,
  prepareRunConfig = (payload = {}) => ({
    ...(payload?.runConfig || {}),
    turnScopeId: payload?.runConfig?.turnScopeId || "turn-default",
    botHookManager,
  }),
  prepareTurnInput = null,
  commitSessionTurn = null,
  stampReusedUserTurnDialogProcessId = async () => {},
  assertPersistenceContextIdentity = null,
} = {}) {
  return new SessionExecutionRunner({
    agentRunner,
    errorLogger: { async log() {} },
    normalizeRunMessage: (message = "") => String(message || "").trim(),
    validateRunInput() {},
    ensureParentAsyncResultContainer: ({ parentAsyncResultContainer = null } = {}) =>
      parentAsyncResultContainer,
    initializeRunSessionRuntime,
    resolveScenarioRunConfig,
    prepareRunConfig,
    prepareTurnInput,
    prepareAgentTurnExecution,
    appendSessionTurn: async () => {},
    assertPersistenceContextIdentity,
    commitSessionTurn,
    stampReusedUserTurnDialogProcessId,
    finalizeRunSession: async () => ({ answer: "ok" }),
    upsertParentAsyncTask: () => {},
    now: () => new Date().toISOString(),
  });
}

test("SessionExecutionRunner validates scoped persistence identity before execution", async () => {
  const calls = [];
  const persistenceContext = { kind: "noobot.session_persistence_scope" };
  const runner = createRunner({
    assertPersistenceContextIdentity: (context, identity) => calls.push({ context, identity }),
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "child-1",
    parentSessionId: "root-1",
    message: "task",
    runConfig: { executionId: "agent:child-1" },
    persistenceContext,
  });

  assert.deepEqual(calls, [{
    context: persistenceContext,
    identity: {
      userId: "u1",
      sessionId: "child-1",
      parentSessionId: "root-1",
      scopeId: "agent:child-1",
    },
  }]);
});

test("SessionExecutionRunner emits bot orchestration hooks", async () => {
  const botHookManager = createBotHookManager();
  const events = [];
  let beforeDispatchContext = null;
  let capturedBuildContextPayload = null;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_SESSION_RUN, () => events.push("before_session_run"));
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    events.push("before_agent_dispatch");
    beforeDispatchContext = ctx;
  });
  botHookManager.on(BOT_HOOK_POINTS.AFTER_AGENT_DISPATCH, () =>
    events.push("after_agent_dispatch"),
  );
  botHookManager.on(BOT_HOOK_POINTS.AFTER_SESSION_RUN, () => events.push("after_session_run"));
  const runner = createRunner({
    botHookManager,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedBuildContextPayload = buildContextPayload;
      const runtimeAgentContext = {
        payload: {
          messages: {
            history: [
              { role: "user", content: "history user" },
              { role: "assistant", content: "history assistant" },
            ],
          },
        },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  const result = await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    attachments: [{ attachmentId: "att1" }],
    runConfig: {},
  });

  assert.equal(result.answer, "ok");
  assert.deepEqual(events, [
    "before_session_run",
    "before_agent_dispatch",
    "after_agent_dispatch",
    "after_session_run",
  ]);
  assert.deepEqual(capturedBuildContextPayload?.userMessageAttachments, [{ attachmentId: "att1" }]);
  assert.equal(capturedBuildContextPayload?.attachmentMetas, undefined);
  assert.equal(Boolean(beforeDispatchContext?.agentContext), false);
  assert.equal(typeof beforeDispatchContext?.agentContextSummary, "object");
  assert.deepEqual(beforeDispatchContext?.messages, [
    { role: "user", content: "history user" },
    { role: "assistant", content: "history assistant" },
  ]);
});

test("before-dispatch takeover can claim root processing before the hook completes", async () => {
  const botHookManager = createBotHookManager();
  const lifecycleStates = [];
  let releaseHook;
  const hookGate = new Promise((resolve) => { releaseHook = resolve; });
  let claimedInsideHook = false;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, async (ctx = {}) => {
    claimedInsideHook = ctx.claimAgentDispatch({ source: "test_takeover" });
    ctx.skipAgentDispatch = true;
    ctx.overrideAgentResult = { output: "hook result", traces: [], turnMessages: [] };
    await hookGate;
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
  const botHookManager = createBotHookManager();
  const lifecycleStates = [];
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, async (ctx = {}) => {
    assert.equal(ctx.claimAgentDispatch({
      source: "workflow_takeover",
      executionKind: "workflow",
      origin: { type: "workflow", workflowRunId: "wf-1" },
      stage: "planning",
    }), true);
    assert.equal(ctx.claimAgentDispatch({
      source: "conflicting_takeover",
      executionKind: "agent",
      origin: { type: "chat" },
    }), false);
    ctx.skipAgentDispatch = true;
    ctx.overrideAgentResult = { output: "hook result", traces: [], turnMessages: [] };
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
  const botHookManager = createBotHookManager();
  const events = [];
  let rootAgentCalls = 0;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({
      owner: "workflow",
      source: "workflow_router",
      executionKind: "workflow",
      origin: { type: "workflow", workflowRunId: "wf-structured" },
      stage: "planning",
    });
    return createBotDispatchHandled({
      owner: "workflow",
      result: { output: "workflow result", traces: [], turnMessages: [], turnTasks: [] },
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
  assert.deepEqual(
    events.find((event) => event?.event === "bot_dispatch_routed")?.data,
    {
      disposition: "handled",
      owner: "workflow",
      claimed: true,
      claimedSource: "workflow_router",
      executionKind: "workflow",
      stage: "planning",
      failureCode: "",
    },
  );
});

test("a handled workflow failure terminates the root Turn without Agent fallback", async () => {
  const botHookManager = createBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_router", executionKind: "workflow" });
    return createBotDispatchHandled({
      owner: "workflow",
      result: { workflow: { failed: true } },
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
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    (error) => error?.code === "WORKFLOW_NODE_FAILED" && error?.dispatchOwner === "workflow",
  );
  assert.equal(rootAgentCalls, 0);
});

test("a claimed dispatch hook failure cannot fall back to the root Agent", async () => {
  const botHookManager = createBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
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
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    /workflow owner failed/,
  );
  assert.equal(rootAgentCalls, 0);
});

test("a claimed dispatch cannot pass the same task back to the root Agent", async () => {
  const botHookManager = createBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    ctx.claimAgentDispatch({ owner: "workflow", source: "workflow_router", executionKind: "workflow" });
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
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    (error) => error?.code === "BOT_DISPATCH_CLAIM_RELEASE_FORBIDDEN",
  );
  assert.equal(rootAgentCalls, 0);
});

test("a structured dispatch takeover must claim ownership before returning handled", async () => {
  const botHookManager = createBotHookManager();
  let rootAgentCalls = 0;
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_AGENT_DISPATCH, () => (
    createBotDispatchHandled({ owner: "workflow", result: { output: "done" } })
  ));
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      rootAgentCalls += 1;
      return { output: "wrong", traces: [], turnMessages: [], turnTasks: [] };
    },
  });

  await assert.rejects(
    () => runner.runSession({ userId: "u1", sessionId: "s1", message: "workflow task", runConfig: {} }),
    (error) => error?.code === "BOT_DISPATCH_CLAIM_REQUIRED",
  );
  assert.equal(rootAgentCalls, 0);
});

test("runner failures expose the committed execution lifecycle snapshot", async () => {
  const runner = createRunner({
    agentRunner: async () => {
      throw new Error("model failed");
    },
  });

  await assert.rejects(
    () => runner.runSession({
      userId: "u1",
      sessionId: "s1",
      message: "task",
      runConfig: {
        executionId: "agent:child-1",
        parentExecutionId: "workflow:root",
        rootExecutionId: "workflow:root",
      },
    }),
    (error) => {
      assert.equal(error?.lifecycle?.state, "failed");
      assert.equal(error?.lifecycle?.executionId, "agent:child-1");
      assert.equal(error?.lifecycle?.parentExecutionId, "workflow:root");
      assert.equal(error?.lifecycle?.rootExecutionId, "workflow:root");
      assert.ok(error?.lifecycle?.revision >= 3);
      assert.equal(error?.lifecycle?.revision, error?.lifecycle?.sequence);
      return true;
    },
  );
});

test("SessionExecutionRunner passes prepared turnScopeId into context building", async () => {
  let capturedRunConfig = null;
  let appendedTurnScopeId = null;
  const runner = createRunner({
    prepareRunConfig: (payload = {}) => ({
      ...(payload?.runConfig || {}),
      turnScopeId: "client-turn:prepared",
    }),
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = {
        payload: { messages: { history: [] } },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });
  runner.appendSessionTurn = async ({ turnScopeId = "" } = {}) => {
    appendedTurnScopeId = turnScopeId;
  };

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
  });

  assert.equal(capturedRunConfig?.turnScopeId, "client-turn:prepared");
  assert.equal(appendedTurnScopeId, "client-turn:prepared");
});

test("SessionExecutionRunner merges top-level turnScopeId before context building", async () => {
  let capturedRunConfig = null;
  let appendedTurnScopeId = null;
  const runner = createRunner({
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = {
        payload: { messages: { history: [] } },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });
  runner.appendSessionTurn = async ({ turnScopeId = "" } = {}) => {
    appendedTurnScopeId = turnScopeId;
  };

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "client-turn:top-level",
    runConfig: {},
  });

  assert.equal(capturedRunConfig?.turnScopeId, "client-turn:top-level");
  assert.equal(appendedTurnScopeId, "client-turn:top-level");
});

test("SessionExecutionRunner commits a normal send for a new turn in an existing session", async () => {
  let committedPayload = null;
  let beforeRunContext = null;
  const botHookManager = createBotHookManager();
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_SESSION_RUN, (context = {}) => {
    beforeRunContext = context;
  });
  const runner = createRunner({
    botHookManager,
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp-next",
      sessionLoadState: "loaded",
      userConfig: {},
      currentSessionModelAlias: "",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    commitSessionTurn: async (payload = {}) => {
      committedPayload = payload;
      return { attachments: [], version: 2 };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "normal next message",
    runConfig: { turnScopeId: "turn-next" },
  });

  assert.equal(committedPayload?.action, "send");
  assert.equal(committedPayload?.resumeDialogProcessId, undefined);
  assert.equal(committedPayload?.resumeTurnScopeId, undefined);
  assert.equal(beforeRunContext?.sessionLoadState, "loaded");
  assert.equal(beforeRunContext?.isContinue, false);
});

test("SessionExecutionRunner commits continue only for a stopped snapshot resume", async () => {
  let committedPayload = null;
  let beforeRunContext = null;
  const botHookManager = createBotHookManager();
  botHookManager.on(BOT_HOOK_POINTS.BEFORE_SESSION_RUN, (context = {}) => {
    beforeRunContext = context;
  });
  const runner = createRunner({
    botHookManager,
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp-resumed",
      sessionLoadState: "loaded",
      userConfig: {},
      currentSessionModelAlias: "",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    commitSessionTurn: async (payload = {}) => {
      committedPayload = payload;
      return { attachments: [], version: 2 };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "resume stopped turn",
    runConfig: {
      turnScopeId: "turn-resumed",
      resumeFromStoppedSnapshot: true,
      resumeDialogProcessId: "dp-stopped",
      resumeTurnScopeId: "turn-stopped",
    },
  });

  assert.equal(committedPayload?.action, "continue");
  assert.equal(committedPayload?.resumeDialogProcessId, "dp-stopped");
  assert.equal(committedPayload?.resumeTurnScopeId, "turn-stopped");
  assert.equal(beforeRunContext?.sessionLoadState, "loaded");
  assert.equal(beforeRunContext?.isContinue, true);
});

test("SessionExecutionRunner stamps reused user with prepared attachments after context building", async () => {
  const calls = [];
  let capturedBuildContextPayload = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp-new",
      sessionLoadState: "loaded",
      userConfig: {},
      currentSessionModelAlias: "",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    stampReusedUserTurnDialogProcessId: async (payload = {}) => {
      calls.push({ type: "stamp", payload });
    },
    prepareTurnInput: async () => ({
      userMessageAttachments: [
        {
          attachmentId: "rich-att",
          sessionId: "s1",
          name: "doc.docx",
          path: "/workspace/doc.docx",
          parsedResult: { attachmentId: "parsed-md" },
        },
      ],
    }),
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      calls.push({ type: "prepare" });
      capturedBuildContextPayload = buildContextPayload;
      const runtimeAgentContext = {
        payload: { messages: { history: [] } },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return {
        agentContext: runtimeAgentContext,
        runtimeAgentContext,
        userMessageAttachments: [
          {
            attachmentId: "rich-att",
            name: "doc.docx",
            path: "/workspace/doc.docx",
            parsedResult: { attachmentId: "parsed-md" },
          },
        ],
      };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "edited",
    attachments: [{ name: "doc.docx", size: 12 }],
    runConfig: {
      reuseExistingUserTurn: true,
      turnScopeId: "client-turn:edited",
    },
  });

  assert.deepEqual(calls.map((item) => item.type), ["stamp", "prepare"]);
  assert.deepEqual(calls[0].payload, {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "client-turn:edited",
    dialogProcessId: "dp-new",
    attachments: [
      {
        attachmentId: "rich-att",
        sessionId: "s1",
        name: "doc.docx",
        path: "/workspace/doc.docx",
        parsedResult: { attachmentId: "parsed-md" },
      },
    ],
  });
  assert.equal(capturedBuildContextPayload?.dialogProcessId, "dp-new");
});

test("SessionExecutionRunner stamps reused user with generated dialogProcessId after context building", async () => {
  const calls = [];
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp-new",
      sessionLoadState: "loaded",
      userConfig: {},
      currentSessionModelAlias: "",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    stampReusedUserTurnDialogProcessId: async (payload = {}) => {
      calls.push(payload);
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "edited",
    runConfig: {
      reuseExistingUserTurn: true,
      turnScopeId: "client-turn:edited",
    },
  });

  assert.deepEqual(calls[0], {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "client-turn:edited",
    dialogProcessId: "dp-new",
    attachments: [],
  });
});

test("SessionExecutionRunner emits bot error hooks", async () => {
  const botHookManager = createBotHookManager();
  const events = [];
  botHookManager.on(BOT_HOOK_POINTS.AGENT_DISPATCH_ERROR, () => events.push("agent_dispatch_error"));
  botHookManager.on(BOT_HOOK_POINTS.SESSION_RUN_ERROR, () => events.push("session_run_error"));
  const runner = createRunner({
    botHookManager,
    agentRunner: async () => {
      throw new Error("mock agent failure");
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({
        userId: "u1",
        sessionId: "s1",
        message: "hello",
        runConfig: {},
      }),
    /mock agent failure/,
  );
  assert.deepEqual(events, ["agent_dispatch_error", "session_run_error"]);
});

test("SessionExecutionRunner emits compat field hit stats event", async () => {
  const events = [];
  const eventListener = {
    onEvent(payload = {}) {
      events.push(payload);
    },
  };
  const runtimeAgentContext = {
    execution: {
      dialogProcessId: "dp1",
      controllers: {
        runtime: {
          systemRuntime: {
            sessionId: "s1",
            dialogProcessId: "dp1",
          },
        },
      },
    },
  };
  const runner = createRunner({
    prepareAgentTurnExecution: async () => ({
      agentContext: runtimeAgentContext,
      runtimeAgentContext,
    }),
    agentRunner: async () => {
      warnAgentContextCompatFieldOnce({
        field: "test.compat.field",
        replacement: "execution.controllers.runtime.test",
      });
      return {
        output: "ok",
        traces: [],
        turnMessages: [],
        turnTasks: [],
      };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
    eventListener,
  });

  const compatEvent = events.find((item) => item?.event === "agent_context_compat_field_hits");
  assert.equal(Boolean(compatEvent), true);
  assert.equal(compatEvent?.data?.sessionId, "s1");
  assert.equal(compatEvent?.data?.dialogProcessId, "dp1");
  assert.equal(compatEvent?.data?.fields?.["test.compat.field"], 1);
});

test("SessionExecutionRunner does not let currentSessionModelAlias override selectedModel", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      sessionLoadState: "created",
      userConfig: {},
      currentSessionModelAlias: "history-model",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = {
        payload: { messages: { history: [] } },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {
      selectedModel: "frontend-model",
      config: { selectedModel: "frontend-model" },
    },
  });

  assert.equal(capturedRunConfig?.selectedModel, "frontend-model");
  assert.equal(capturedRunConfig?.config?.selectedModel, "frontend-model");
  assert.equal(capturedRunConfig?.runtimeModel, undefined);
});

test("SessionExecutionRunner restores currentSessionModelAlias when selectedModel is absent", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
      usedSessionId: "s1",
      dialogProcessId: "dp1",
      sessionLoadState: "loaded",
      userConfig: {},
      currentSessionModelAlias: "history-model",
      executionStartIndex: 0,
      runtimeEventListener: eventListener,
    }),
    resolveScenarioRunConfig: (runConfig = {}) => runConfig,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = {
        payload: { messages: { history: [] } },
        execution: { controllers: { runtime: { attachmentMetas: [] } } },
      };
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: {},
  });

  assert.equal(capturedRunConfig?.runtimeModel, "history-model");
});

test("SessionExecutionRunner preserves provided thinkingStartedAt", async () => {
  let capturedFinalizePayload = null;
  const providedThinkingStartedAt = "2026-01-02T03:04:05.006Z";
  const runner = createRunner({});
  runner.finalizeRunSession = async (payload = {}) => {
    capturedFinalizePayload = payload;
    return { answer: "ok" };
  };

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    runConfig: { thinkingStartedAt: providedThinkingStartedAt },
  });

  assert.equal(capturedFinalizePayload?.thinkingStartedAt, providedThinkingStartedAt);
});
