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
      const runtimeAgentContext = createTestAgentExecutionScope({ attachmentMetas: [] });
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
    commitSessionTurn: async (payload = {}) => {
      appendedTurnScopeId = payload.turnScopeId;
      return {
        attachments: [],
        userMessage: {
          messageUid: "sm_prepared",
          role: "user",
          content: payload.content,
          dialogProcessId: payload.dialogProcessId,
          turnScopeId: payload.turnScopeId,
        },
      };
    },
  });

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
      const runtimeAgentContext = createTestAgentExecutionScope({ attachmentMetas: [] });
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
    commitSessionTurn: async (payload = {}) => {
      appendedTurnScopeId = payload.turnScopeId;
      return {
        attachments: [],
        userMessage: {
          messageUid: "sm_top_level",
          role: "user",
          content: payload.content,
          dialogProcessId: payload.dialogProcessId,
          turnScopeId: payload.turnScopeId,
        },
      };
    },
  });

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
  const botHookManager = createTestBotHookManager();
  botHookManager.on(HOOK_POINT.BOT.BEFORE_SESSION_RUN, (context = {}) => {
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
      return { attachments: [], aggregateVersion: 2 };
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
  const botHookManager = createTestBotHookManager();
  botHookManager.on(HOOK_POINT.BOT.BEFORE_SESSION_RUN, (context = {}) => {
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
      return { attachments: [], aggregateVersion: 2 };
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

test("SessionExecutionRunner asserts reused user with prepared attachments after context building", async () => {
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
    assertReusedUserTurnIdentity: async (payload = {}) => {
      calls.push({ type: "assert", payload });
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
      const runtimeAgentContext = createTestAgentExecutionScope({ attachmentMetas: [] });
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
    dialogProcessId: "dp-new",
    message: "edited",
    attachments: [{ name: "doc.docx", size: 12 }],
    runConfig: {
      reuseExistingUserTurn: true,
      turnScopeId: "client-turn:edited",
    },
  });

  assert.deepEqual(
    calls.map((item) => item.type),
    ["assert", "assert", "prepare"],
  );
  assert.deepEqual(calls[1].payload, {
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

test("SessionExecutionRunner preserves the precommitted reused Turn dialogProcessId", async () => {
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
    assertReusedUserTurnIdentity: async (payload = {}) => {
      calls.push(payload);
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-new",
    message: "edited",
    runConfig: {
      reuseExistingUserTurn: true,
      turnScopeId: "client-turn:edited",
    },
  });

  assert.deepEqual(calls[1], {
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    turnScopeId: "client-turn:edited",
    dialogProcessId: "dp-new",
    attachments: [],
  });
});

test("SessionExecutionRunner rejects reused Turn execution without a precommitted dialogProcessId", async () => {
  const runner = createRunner();
  await assert.rejects(
    runner.runSession({
      userId: "u1",
      sessionId: "s1",
      message: "edited",
      runConfig: {
        reuseExistingUserTurn: true,
        turnScopeId: "client-turn:edited",
      },
    }),
    (error) => error?.errorCode === "MISSING_REUSED_TURN_DIALOG_PROCESS_ID",
  );
});

