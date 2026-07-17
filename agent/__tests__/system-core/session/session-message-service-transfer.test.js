/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../../src/system-core/session/services/session-message-service.js";

test("SessionMessageService.appendTurn persists transferEnvelopes", async () => {
  const saved = [];
  const sessionRepo = {
    async resolveParentSessionId() {
      return "";
    },
    async ensureSession() {},
    async findById() {
      return {
        sessionId: "s1",
        parentSessionId: "",
        messages: [],
      };
    },
    async save(_userId, session) {
      saved.push(session);
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-07T00:00:00.000Z",
  });
  const envelope = {
    protocol: "noobot.semantic-transfer",
    version: 1,
    direction: "output",
    transport: "file",
    files: [
      {
        filePath: "/workspace/a.md",
        attachmentMeta: {
          attachmentId: "att_1",
          name: "a.md",
          owner: { type: "plugin", id: "harness-plugin" },
        },
      },
    ],
  };
  await service.appendTurn({
    userId: "u1",
    sessionId: "s1",
    role: "assistant",
    content: "done",
    attachmentMetas: [{ attachmentId: "att_1", name: "a.md" }],
    transferEnvelopes: [envelope],
  });

  assert.equal(saved.length, 1);
  const lastMessage = saved[0]?.messages?.[0];
  assert.equal("attachmentMetas" in lastMessage, false);
  assert.equal("transferEnvelopes" in lastMessage, true);
  assert.deepEqual(lastMessage?.transferEnvelopes, [
    {
      protocol: "noobot.semantic-transfer",
      version: 1,
      direction: "output",
      transport: "file",
      files: [
        {
          attachmentId: "att_1",
          name: "a.md",
          path: "/workspace/a.md",
          owner: { type: "plugin", id: "harness-plugin" },
        },
      ],
    },
  ]);
  assert.equal("attachmentMeta" in lastMessage.transferEnvelopes[0], false);
  assert.equal("attachmentMeta" in lastMessage.transferEnvelopes[0].files[0], false);
  assert.equal("id" in lastMessage.transferEnvelopes[0].files[0], false);
  assert.equal("type" in lastMessage.transferEnvelopes[0].files[0], false);
  assert.equal("source" in lastMessage.transferEnvelopes[0].files[0], false);
});

test("SessionMessageService.appendTurn stores thinking timing in turnTimings without message timing", async () => {
  const saved = [];
  const session = {
    sessionId: "s1",
    parentSessionId: "",
    messages: [],
    turnTimings: [],
  };
  const sessionRepo = {
    async resolveParentSessionId() {
      return "";
    },
    async ensureSession() {},
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

  await service.appendTurn({
    userId: "u1",
    sessionId: "s1",
    role: "assistant",
    content: "done",
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
    thinkingStartedAt: "",
    thinkingFinishedAt: "",
    turnTimingThinkingStartedAt: "2026-07-08T15:45:58.275Z",
    turnTimingThinkingFinishedAt: "2026-07-08T15:47:11.710Z",
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].messages[0].thinkingStartedAt, undefined);
  assert.equal(saved[0].messages[0].thinkingFinishedAt, undefined);
  assert.deepEqual(saved[0].turnTimings, [
    {
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      thinkingStartedAt: "2026-07-08T15:45:58.275Z",
      thinkingFinishedAt: "2026-07-08T15:47:11.710Z",
    },
  ]);
});

test("SessionMessageService.appendTurn keeps existing turn timing when later same-turn appends pass empty timing", async () => {
  const saved = [];
  const session = {
    sessionId: "s1",
    parentSessionId: "",
    messages: [],
    turnTimings: [],
  };
  const sessionRepo = {
    async resolveParentSessionId() {
      return "";
    },
    async ensureSession() {},
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

  await service.appendTurn({
    userId: "u1",
    sessionId: "s1",
    role: "user",
    content: "injected guidance",
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
    thinkingStartedAt: "",
    thinkingFinishedAt: "",
    turnTimingThinkingStartedAt: "2026-07-08T16:29:24.453Z",
    turnTimingThinkingFinishedAt: "2026-07-08T16:30:44.744Z",
    injectedMessage: true,
  });
  await service.appendTurn({
    userId: "u1",
    sessionId: "s1",
    role: "assistant",
    content: "done",
    turnScopeId: "turn-1",
    dialogProcessId: "dp-1",
    thinkingStartedAt: "",
    thinkingFinishedAt: "",
    turnTimingThinkingStartedAt: "",
    turnTimingThinkingFinishedAt: "",
  });

  assert.equal(saved.length, 2);
  assert.equal(saved[1].messages[0].thinkingStartedAt, undefined);
  assert.equal(saved[1].messages[1].thinkingStartedAt, undefined);
  assert.deepEqual(saved[1].turnTimings, [
    {
      turnScopeId: "turn-1",
      dialogProcessId: "dp-1",
      thinkingStartedAt: "2026-07-08T16:29:24.453Z",
      thinkingFinishedAt: "2026-07-08T16:30:44.744Z",
    },
  ]);
});

test("SessionMessageService.deleteFromMessage prunes orphan turnTimings", async () => {
  const saved = [];
  const session = {
    sessionId: "s1",
    parentSessionId: "",
    version: 1,
    messages: [
      { role: "assistant", content: "keep", turnScopeId: "turn-keep", dialogProcessId: "dp-keep" },
      { role: "user", content: "hi", turnScopeId: "turn-delete", dialogProcessId: "dp-delete" },
    ],
    turnTimings: [
      { turnScopeId: "turn-delete", dialogProcessId: "dp-delete", thinkingStartedAt: "2026-07-08T00:00:00.000Z" },
      { turnScopeId: "turn-keep", dialogProcessId: "dp-keep", thinkingFinishedAt: "2026-07-08T00:00:01.000Z" },
    ],
  };
  const sessionRepo = {
    async resolveParentSessionId() {
      return "";
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
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].turnTimings, [
    { turnScopeId: "turn-keep", dialogProcessId: "dp-keep", thinkingFinishedAt: "2026-07-08T00:00:01.000Z" },
  ]);
});

test("SessionMessageService.replaceTurn prunes replaced turnTimings", async () => {
  const saved = [];
  const session = {
    sessionId: "s1",
    parentSessionId: "",
    version: 1,
    messages: [
      { role: "user", content: "keep", turnScopeId: "turn-keep", dialogProcessId: "dp-keep" },
      { role: "assistant", content: "old", turnScopeId: "turn-old", dialogProcessId: "dp-old" },
    ],
    turnTimings: [
      { turnScopeId: "turn-old", dialogProcessId: "dp-old", thinkingStartedAt: "2026-07-08T00:00:00.000Z" },
      { turnScopeId: "turn-keep", dialogProcessId: "dp-keep", thinkingFinishedAt: "2026-07-08T00:00:01.000Z" },
    ],
  };
  const sessionRepo = {
    async resolveParentSessionId() {
      return "";
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

  await service.replaceTurn({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "turn-old" },
    newContent: "new",
    turnScopeId: "turn-new",
  });

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].turnTimings, []);
});
