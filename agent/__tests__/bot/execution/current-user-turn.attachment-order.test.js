/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { prepareCurrentUserTurn } from "../../../src/bot/execution/runner/current-user-turn.js";

function createInput(overrides = {}) {
  return {
    normalizedMessage: "message with attachment",
    attachments: [{ name: "report.pdf" }],
    systemMessages: [],
    eventListener: null,
    userInteractionBridge: null,
    abortSignal: null,
    parentAsyncResultContainer: null,
    persistenceContext: null,
    contextMode: "conversation",
    userId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "dp1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    caller: "user",
    userConfig: {},
    resolvedRunConfig: {},
    requestRunConfig: {},
    scenarioResolvedRunConfig: {},
    ...overrides,
  };
}

function committedUserMessage() {
  return {
    messageUid: "sm_1",
    messageId: "msg_1",
    role: "user",
    type: "message",
    content: "message with attachment",
    userName: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "dp1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    messageOrigin: "natural",
    userMetaMaterialized: true,
    attachments: [],
  };
}

test("attachment preprocessing failure consumes the already accepted user message", async () => {
  const calls = [];
  const userMessage = committedUserMessage();
  await assert.rejects(
    prepareCurrentUserTurn(
      createInput({
        turnAcceptance: {
          commandId: "command-1",
          sessionId: "s1",
          turnScopeId: "t1",
          dialogProcessId: "dp1",
          messageUid: "sm_1",
          aggregateVersion: 1,
          committedEventPublished: true,
        },
        assertReusedUserTurnIdentity: async () => {
          calls.push("assert");
          return { session: { sessionId: "s1" }, aggregateVersion: 1, userMessage };
        },
        commitSessionTurn: async () => {
          throw new Error("Runner must not commit an accepted user Turn");
        },
        prepareTurnInput: async () => {
          calls.push("prepare");
          throw new Error("attachment ingestion failed");
        },
        bindSessionTurnAttachments: async () => {
          calls.push("bind");
        },
      }),
    ),
    /attachment ingestion failed/,
  );

  assert.deepEqual(calls, ["assert", "prepare"]);
  assert.equal(userMessage.messageUid, "sm_1");
  assert.deepEqual(userMessage.attachments, []);
});

test("accepted user message binds canonical attachments before Context construction", async () => {
  const calls = [];
  const attachment = {
    attachmentId: "att_1",
    sessionId: "s1",
    attachmentSource: "user",
    name: "report.pdf",
    path: "/workspace/report.pdf",
  };
  const committed = committedUserMessage();
  const bound = { ...committed, attachments: [attachment] };
  const result = await prepareCurrentUserTurn(
    createInput({
      turnAcceptance: {
        commandId: "command-1",
        sessionId: "s1",
        turnScopeId: "t1",
        dialogProcessId: "dp1",
        messageUid: "sm_1",
        aggregateVersion: 1,
        committedEventPublished: true,
      },
      assertReusedUserTurnIdentity: async () => {
        calls.push("assert");
        return { session: { sessionId: "s1" }, aggregateVersion: 1, userMessage: committed };
      },
      commitSessionTurn: async () => {
        throw new Error("Runner must not commit an accepted user Turn");
      },
      prepareTurnInput: async () => {
        calls.push("prepare");
        return { userMessageAttachments: [attachment] };
      },
      bindSessionTurnAttachments: async (payload) => {
        calls.push("bind");
        assert.equal(payload.messageUid, "sm_1");
        assert.equal(payload.expectedAggregateVersion, 1);
        return {
          aggregateVersion: 2,
          attachments: [attachment],
          userMessage: bound,
        };
      },
    }),
  );

  assert.deepEqual(calls, ["assert", "prepare", "bind"]);
  assert.deepEqual(result.currentUserMessage, bound);
  assert.deepEqual(result.buildContextPayload.currentUserMessage, bound);
  assert.deepEqual(result.buildContextPayload.userMessageAttachments, [attachment]);
});
