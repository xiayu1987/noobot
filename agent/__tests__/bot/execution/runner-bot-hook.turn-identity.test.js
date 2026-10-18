/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import { createRuntimeContext } from "../../../src/runtime/runtime-context-factory.js";
import assert from "node:assert/strict";
import {
  createRunner,
  createTestBotHookManager,
  HOOK_POINT,
  createTestAgentExecutionScope,
  persistedUserMessage,
} from "./runner-bot-hook.fixtures.js";
import { createAcceptedRunIdentity } from "../../helpers/accepted-run-identity.js";

test("SessionExecutionRunner rejects a prepared turnScopeId that diverges from the accepted Turn", async () => {
  const runner = createRunner({
    prepareRunConfig: (payload = {}) => ({
      ...(payload?.runConfig || {}),
      turnScopeId: "client-turn:prepared",
    }),
  });

  await assert.rejects(
    runner.runAcceptedSession({
      userId: "u1",
      sessionId: "s1",
      message: "hello",
      turnScopeId: "client-turn:accepted",
    }),
    (error) =>
      /Turn acceptance receipt does not match the current execution identity/.test(
        error?.cause?.message || error?.message,
      ),
  );
});

test("SessionExecutionRunner merges top-level turnScopeId before context building", async () => {
  let capturedRunConfig = null;
  const runner = createRunner({
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      capturedRunConfig = buildContextPayload.runConfig;
      const runtimeAgentContext = createTestAgentExecutionScope(createRuntimeContext());
      return { agentContext: runtimeAgentContext, runtimeAgentContext };
    },
  });

  await runner.runAcceptedSession({
    userId: "u1",
    sessionId: "s1",
    message: "hello",
    turnScopeId: "client-turn:top-level",
    runConfig: {},
  });

  assert.equal(capturedRunConfig?.turnScopeId, "client-turn:top-level");
});

for (const { name, dialogProcessId, turnScopeId, runConfig, isContinue } of [
  {
    name: "a normal send for a new turn in an existing session",
    dialogProcessId: "dp-next",
    turnScopeId: "turn-next",
    runConfig: {},
    isContinue: false,
  },
  {
    name: "continue only for a stopped snapshot resume",
    dialogProcessId: "dp-resumed",
    turnScopeId: "turn-resumed",
    runConfig: {
      resumeFromStoppedSnapshot: true,
      resumeDialogProcessId: "dp-stopped",
      resumeTurnScopeId: "turn-stopped",
    },
    isContinue: true,
  },
]) {
  test(`SessionExecutionRunner runs ${name}`, async () => {
    let beforeRunContext = null;
    const botHookManager = createTestBotHookManager();
    botHookManager.on(HOOK_POINT.BOT.BEFORE_SESSION_RUN, (context = {}) => {
      beforeRunContext = context;
    });
    const runner = createRunner({
      botHookManager,
      initializeRunSessionRuntime: async ({ eventListener = null } = {}) => ({
        usedSessionId: "s1",
        dialogProcessId,
        sessionLoadState: "loaded",
        userConfig: {},
        currentSessionModelAlias: "",
        runtimeEventListener: eventListener,
      }),
    });

    await runner.runAcceptedSession(
      { userId: "u1", sessionId: "s1", message: "next", turnScopeId, runConfig },
      { dialogProcessId },
    );

    assert.equal(beforeRunContext?.sessionLoadState, "loaded");
    assert.equal(beforeRunContext?.isContinue, isContinue);
  });
}

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
      runtimeEventListener: eventListener,
    }),
    assertReusedUserTurnIdentity: async (payload = {}) => {
      calls.push({ type: "assert", payload });
      return { userMessage: persistedUserMessage(payload) };
    },
    prepareTurnInput: async () => ({
      userMessageAttachments: [
        {
          attachmentId: "rich-att",
          sessionId: "s1",
          attachmentSource: "user",
          name: "doc.docx",
          path: "/workspace/doc.docx",
        },
      ],
    }),
    prepareAgentTurnExecution: async ({ buildContextPayload = {} } = {}) => {
      calls.push({ type: "prepare" });
      capturedBuildContextPayload = buildContextPayload;
      const runtimeAgentContext = createTestAgentExecutionScope(createRuntimeContext());
      return {
        agentContext: runtimeAgentContext,
        runtimeAgentContext,
        userMessageAttachments: [
          {
            attachmentId: "rich-att",
            sessionId: "s1",
            attachmentSource: "user",
            name: "doc.docx",
            path: "/workspace/doc.docx",
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
    turnScopeId: "client-turn:edited",
    runConfig: createAcceptedRunIdentity("client-turn:edited", {
      reuseExistingUserTurn: true,
    }),
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
        attachmentSource: "user",
        name: "doc.docx",
        path: "/workspace/doc.docx",
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
      runtimeEventListener: eventListener,
    }),
    assertReusedUserTurnIdentity: async (payload = {}) => {
      calls.push(payload);
      return { userMessage: persistedUserMessage(payload) };
    },
  });

  await runner.runSession({
    userId: "u1",
    sessionId: "s1",
    dialogProcessId: "dp-new",
    message: "edited",
    turnScopeId: "client-turn:edited",
    runConfig: createAcceptedRunIdentity("client-turn:edited", {
      reuseExistingUserTurn: true,
    }),
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
      turnScopeId: "client-turn:edited",
      runConfig: {
        reuseExistingUserTurn: true,
      },
    }),
    (error) => error?.cause?.code === "MISSING_REUSED_TURN_DIALOG_PROCESS_ID",
  );
});
