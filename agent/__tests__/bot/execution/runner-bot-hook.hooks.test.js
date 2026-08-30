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

test("SessionExecutionRunner emits bot orchestration hooks", async () => {
  const botHookManager = createTestBotHookManager();
  const events = [];
  let beforeDispatchContext = null;
  let capturedBuildContextPayload = null;
  botHookManager.on(HOOK_POINT.BOT.BEFORE_SESSION_RUN, () => events.push("bot.before_session_run"));
  botHookManager.on(HOOK_POINT.BOT.BEFORE_AGENT_DISPATCH, (ctx = {}) => {
    events.push("bot.before_agent_dispatch");
    beforeDispatchContext = ctx;
  });
  botHookManager.on(HOOK_POINT.BOT.AFTER_AGENT_DISPATCH, () =>
    events.push("bot.after_agent_dispatch"),
  );
  botHookManager.on(HOOK_POINT.BOT.AFTER_SESSION_RUN, () => events.push("bot.after_session_run"));
  const runner = createRunner({
    botHookManager,
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedBuildContextPayload = buildContextPayload;
      const runtimeAgentContext = createTestAgentExecutionScope(
        { attachmentMetas: [] },
        {
          messageBlocks: {
            history: [
              { role: "user", content: "history user" },
              { role: "assistant", content: "history assistant" },
            ],
          },
        },
      );
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  const result = await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    attachments: [{ attachmentId: "att1", sessionId: "s1" }],
    runConfig: {},
  });

  assert.equal(result.answer, "ok");
  assert.deepEqual(events, [
    "bot.before_session_run",
    "bot.before_agent_dispatch",
    "bot.after_agent_dispatch",
    "bot.after_session_run",
  ]);
  assert.deepEqual(capturedBuildContextPayload?.userMessageAttachments, [
    { attachmentId: "att1", sessionId: "s1" },
  ]);
  assert.equal(capturedBuildContextPayload?.attachmentMetas, undefined);
  assert.equal(
    beforeDispatchContext?.agentContext?.bindings?.runtime?.systemRuntime?.messageEventStream
      ?.activeMessageId,
    beforeDispatchContext?.runConfig?.messageId,
  );
  assert.equal(
    beforeDispatchContext?.agentContext?.bindings?.runtime?.systemRuntime?.messageEventStream
      ?.activePresentationMessageId,
    beforeDispatchContext?.runConfig?.presentationMessageId,
  );
  assert.match(beforeDispatchContext?.runConfig?.messageId, /^msg_event_msg_/);
  assert.match(beforeDispatchContext?.runConfig?.presentationMessageId, /^msg_/);
  assert.equal(beforeDispatchContext?.runtimeAgentContext, undefined);
  assert.equal(typeof beforeDispatchContext?.agentContextSummary, "object");
  assert.equal(beforeDispatchContext?.messages, undefined);
  assert.deepEqual(
    beforeDispatchContext?.modelContext?.messages.map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "history user" },
      { role: "assistant", content: "history assistant" },
    ],
  );
  assert.equal(beforeDispatchContext?.modelContext?.protocolVersion, 3);
  assert.deepEqual(
    {
      ...beforeDispatchContext?.modelContext?.messageBlocks,
      history: beforeDispatchContext?.modelContext?.messageBlocks?.history.map(
        ({ role, content }) => ({ role, content }),
      ),
    },
    {
      system: [],
      history: [
        { role: "user", content: "history user" },
        { role: "assistant", content: "history assistant" },
      ],
      incremental: [],
    },
  );
});

test("runner failures expose the committed execution lifecycle snapshot", async () => {
  const runner = createRunner({
    agentRunner: async () => {
      throw new Error("model failed");
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({
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

test("runner failure owns lifecycle metadata without mutating an immutable abort reason", async () => {
  const abortReason = Object.freeze({
    type: "socket_close",
    code: 1011,
    reason: "primary transport failure",
  });
  const runner = createRunner({
    agentRunner: async () => {
      throw abortReason;
    },
  });

  await assert.rejects(
    () =>
      runner.runSession({
        userId: "u1",
        sessionId: "s1",
        message: "task",
        runConfig: {},
      }),
    (error) => {
      assert.equal(error.message, "primary transport failure");
      assert.equal(error.cause, abortReason);
      assert.equal(error.lifecycle?.state, "interrupted");
      assert.equal(error.lifecycle?.stopType, "socket_close");
      assert.equal(Object.hasOwn(abortReason, "lifecycle"), false);
      return true;
    },
  );
});

test("SessionExecutionRunner emits bot error hooks", async () => {
  const botHookManager = createTestBotHookManager();
  const events = [];
  botHookManager.on(HOOK_POINT.BOT.AGENT_DISPATCH_ERROR, () =>
    events.push("bot.agent_dispatch_error"),
  );
  botHookManager.on(HOOK_POINT.BOT.SESSION_RUN_ERROR, () => events.push("bot.session_run_error"));
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
  assert.deepEqual(events, ["bot.agent_dispatch_error", "bot.session_run_error"]);
});
