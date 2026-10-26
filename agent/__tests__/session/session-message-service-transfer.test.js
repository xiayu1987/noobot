/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { TRANSFER_VERSION } from "@noobot/semantic-transfer-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";

const TEST_SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-session-dir-"));
after(() => fs.rmSync(TEST_SESSION_DIR, { recursive: true, force: true }));

function emptyTurnLifecycle() {
  return {
    turns: {},
    activeTurnScopeId: "",
    nextSequence: 0,
    commandReceipts: [],
    replacedTurns: {},
  };
}

test("SessionMessageService.appendTurns persists transferEnvelopes", async () => {
  const saved = [];
  const sessionRepo = {
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir: TEST_SESSION_DIR };
    },
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async ensureSession() {},
    async findTurnView() {
      const session = {
        ...createTestSessionRequiredFields(),
        sessionId: "s1",
        aggregateVersion: 0,
        parentSessionId: "",
        messages: [],
      };
      return { session, turnScopeIds: [] };
    },
    async saveTurnView(_userId, session) {
      saved.push(session);
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-07T00:00:00.000Z",
  });
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: TRANSFER_VERSION,
    transferId: "transfer:message-att-1:tool:call-att-1:output:tool_result_text:structured",
    presentationMessageId: "message-att-1",
    identity: {
      sessionId: "s1",
      turnScopeId: "turn-att-1",
      runId: "run-att-1",
      producer: { type: "plugin", id: "harness-plugin" },
    },
    direction: "output",
    payload: {
      mode: "attachment",
      attachments: [
        {
          identity: { attachmentId: "att_1", sessionId: "s1", attachmentSource: "model" },
          role: "primary",
          name: "a.md",
          mimeType: "text/markdown",
        },
      ],
    },
    intent: {
      source: "plugin",
      reason: "semantic_transfer_tool_result",
      scenario: "tool",
      strategy: "tool_result_text",
    },
    meta: { persisted: true },
  };
  await service.appendTurns({
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_done",
        role: "assistant",
        presentationMessageId: "pm_fx1",
        modelMessageId: "mm_session_message_service__1",
        content: "done",
        transferEnvelopes: [envelope],
      },
    ],
  });

  assert.equal(saved.length, 1);
  const lastMessage = saved[0]?.messages?.[0];
  assert.equal("attachmentMetas" in lastMessage, false);
  assert.equal("transferEnvelopes" in lastMessage, true);
  assert.deepEqual(lastMessage?.transferEnvelopes, [envelope]);
  assert.equal(
    lastMessage.transferEnvelopes[0].payload.attachments[0].identity.attachmentId,
    "att_1",
  );
});

test("SessionMessageService.appendTurns leaves turnTimings to the timing fact writer", async () => {
  const saved = [];
  const session = {
    ...createTestSessionRequiredFields(),
    sessionId: "s1",
    aggregateVersion: 0,
    parentSessionId: "",
    messages: [],
    turnTimings: [],
  };
  const sessionRepo = {
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir: TEST_SESSION_DIR };
    },
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async ensureSession() {},
    async findTurnView() {
      return { session, turnScopeIds: [] };
    },
    async findById() {
      return session;
    },
    async saveTurnView(_userId, nextSession) {
      saved.push(JSON.parse(JSON.stringify(nextSession)));
    },
    async save(_userId, nextSession) {
      saved.push(JSON.parse(JSON.stringify(nextSession)));
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-07T00:00:00.000Z",
  });

  await service.appendTurns({
    userId: "u1",
    sessionId: "s1",
    turns: [
      {
        messageUid: "sm_done",
        role: "assistant",
        presentationMessageId: "pm_fx2",
        modelMessageId: "mm_session_message_service__2",
        content: "done",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
    ],
  });

  assert.equal(saved.length, 1);
  assert.equal(Object.hasOwn(saved[0].messages[0], "thinkingStartedAt"), false);
  assert.equal(Object.hasOwn(saved[0].messages[0], "thinkingFinishedAt"), false);
  assert.deepEqual(saved[0].turnTimings, []);
});

test("SessionMessageService.upsertTurnTiming is first-write-wins and rejects conflicting facts", async () => {
  const saved = [];
  const session = {
    ...createTestSessionRequiredFields(),
    sessionId: "s1",
    aggregateVersion: 0,
    parentSessionId: "",
    messages: [],
    turnTimings: [],
  };
  const sessionRepo = {
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir: TEST_SESSION_DIR };
    },
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async ensureSession() {},
    async findTurnView() {
      return { session, turnScopeIds: [] };
    },
    async findById() {
      return session;
    },
    async saveTurnView(_userId, nextSession) {
      saved.push(JSON.parse(JSON.stringify(nextSession)));
    },
    async save(_userId, nextSession) {
      saved.push(JSON.parse(JSON.stringify(nextSession)));
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-07T00:00:00.000Z",
  });

  const timing = {
    userId: "u1",
    sessionId: "s1",
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
    thinkingFinishedAt: "2026-07-08T16:30:44.744Z",
    modelLoopRound: 4,
  };

  assert.equal((await service.upsertTurnTiming(timing)).upserted, true);
  assert.equal((await service.upsertTurnTiming(timing)).reason, "unchanged");
  await assert.rejects(
    service.upsertTurnTiming({ ...timing, thinkingFinishedAt: "2026-07-08T16:31:00.000Z" }),
    { code: "SESSION_TURN_TIMING_CONFLICT" },
  );
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].turnTimings, [
    {
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      thinkingFinishedAt: "2026-07-08T16:30:44.744Z",
      modelLoopRound: 4,
    },
  ]);
});

test("SessionMessageService.deleteFromMessage prunes orphan turnTimings", async () => {
  const saved = [];
  const session = {
    ...createTestSessionRequiredFields(),
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 1,
    messages: [
      {
        role: "assistant",
        presentationMessageId: "pm_fx4",
        modelMessageId: "mm_session_message_service__4",
        content: "keep",
        turnScopeId: "turn-keep",
        dialogProcessId: "dp-keep",
      },
      { role: "user", content: "hi", turnScopeId: "turn-delete", dialogProcessId: "dp-delete" },
    ],
    turnTimings: [
      {
        turnScopeId: "turn-delete",
        dialogProcessId: "dp-delete",
        thinkingFinishedAt: "2026-07-08T00:00:00.500Z",
      },
      {
        turnScopeId: "turn-keep",
        dialogProcessId: "dp-keep",
        thinkingFinishedAt: "2026-07-08T00:00:01.000Z",
      },
    ],
    turnLifecycle: emptyTurnLifecycle(),
  };
  const sessionRepo = {
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir: TEST_SESSION_DIR };
    },
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async findById() {
      return session;
    },
    async save(_userId, nextSession) {
      saved.push(JSON.parse(JSON.stringify(nextSession)));
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-07T00:00:00.000Z",
  });

  await service.deleteFromMessage({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "turn-delete" },
    commandId: "delete-turn-timing",
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].turnTimings, [
    {
      turnScopeId: "turn-keep",
      dialogProcessId: "dp-keep",
      thinkingFinishedAt: "2026-07-08T00:00:01.000Z",
    },
  ]);
});

test("SessionMessageService.replaceTurn prunes replaced turnTimings", async () => {
  const saved = [];
  const session = {
    ...createTestSessionRequiredFields(),
    sessionId: "s1",
    parentSessionId: "",
    aggregateVersion: 1,
    messages: [
      {
        sessionId: "s1",
        role: "user",
        content: "keep",
        turnScopeId: "turn-keep",
        dialogProcessId: "dp-keep",
      },
      {
        sessionId: "s1",
        role: "assistant",
        presentationMessageId: "pm_fx5",
        modelMessageId: "mm_session_message_service__5",
        content: "old",
        turnScopeId: "turn-old",
        dialogProcessId: "dp-old",
      },
    ],
    turnTimings: [
      {
        turnScopeId: "turn-old",
        dialogProcessId: "dp-old",
        thinkingFinishedAt: "2026-07-08T00:00:00.500Z",
      },
      {
        turnScopeId: "turn-keep",
        dialogProcessId: "dp-keep",
        thinkingFinishedAt: "2026-07-08T00:00:01.000Z",
      },
    ],
    turnLifecycle: emptyTurnLifecycle(),
  };
  const sessionRepo = {
    async locateSessionScope() {
      return { resolvedParentSessionId: "", sessionDir: TEST_SESSION_DIR };
    },
    async withSessionMutation(_u, _s, operation) {
      return operation(await this.locateSessionScope());
    },
    async findById() {
      return session;
    },
    async save(_userId, nextSession) {
      saved.push(JSON.parse(JSON.stringify(nextSession)));
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-07T00:00:00.000Z",
    allocateDialogProcessId: () => "dp-new",
  });

  await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "turn-old" },
    newContent: "new",
    turnScopeId: "turn-new",
    commandId: "replace-turn-timing",
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].turnTimings, []);
});
