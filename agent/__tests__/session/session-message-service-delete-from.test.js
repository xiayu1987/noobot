/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";

function createService({ initialSession }) {
  const saved = [];
  let currentSession = structuredClone({
    aggregateVersion: 0,
    turnLifecycle: { turns: {}, commandReceipts: [] },
    ...initialSession,
  });
  const sessionRepo = {
    async resolveParentSessionId() {
      return currentSession?.parentSessionId || "";
    },
    async findById() {
      return currentSession;
    },
    async save(_userId, session) {
      currentSession = structuredClone(session);
      saved.push(structuredClone(session));
    },
  };
  const service = new SessionMessageService({
    sessionRepo,
    now: () => "2026-06-17T00:00:00.000Z",
  });
  return { service, saved, getSession: () => currentSession };
}

test("SessionMessageService.deleteFromMessage deletes from anchor message to session tail", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      aggregateVersion: 2,
      messages: [
        { turnScopeId: "scope-keep", role: "user", content: "keep" },
        { turnScopeId: "scope-delete", role: "assistant", content: "delete" },
        { turnScopeId: "scope-tail", role: "user", content: "delete too" },
      ],
    },
  });

  const result = await service.deleteFromMessage({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-delete" },
    expectedAggregateVersion: 2,
    commandId: "delete-tail",
  });

  assert.equal(result.deletedCount, 2);
  assert.equal(result.anchorIndex, 1);
  assert.deepEqual(result.deletedTurnScopeIds, ["scope-delete", "scope-tail"]);
  assert.equal(result.aggregateVersion, 3);
  assert.equal(saved.length, 1);
  assert.deepEqual(
    saved[0].messages.map((message) => message.content),
    ["keep"],
  );
  assert.equal(saved[0].aggregateVersion, 3);
  assert.equal(saved[0].updatedAt, "2026-06-17T00:00:00.000Z");
});

test("SessionMessageService.deleteFromMessage mutates only the owning Session aggregate", async () => {
  const parent = createService({
    initialSession: {
      sessionId: "parent",
      messages: [
        { turnScopeId: "parent-keep", role: "user", content: "keep" },
        { turnScopeId: "parent-delete", role: "assistant", content: "delete" },
      ],
    },
  });
  const child = createService({
    initialSession: {
      sessionId: "child",
      parentSessionId: "parent",
      messages: [{ turnScopeId: "child-turn", role: "user", content: "child" }],
    },
  });

  await parent.service.deleteFromMessage({
    userId: "u1",
    sessionId: "parent",
    anchor: { turnScopeId: "parent-delete" },
    commandId: "delete-parent-tail",
  });

  assert.deepEqual(
    parent.getSession().messages.map((item) => item.turnScopeId),
    ["parent-keep"],
  );
  assert.deepEqual(
    child.getSession().messages.map((item) => item.turnScopeId),
    ["child-turn"],
  );
});

test("SessionMessageService.deleteFromMessage removes deleted terminal Turns from refresh projection", async () => {
  const { service, getSession } = createService({
    initialSession: {
      sessionId: "s1",
      aggregateVersion: 2,
      messages: [
        { turnScopeId: "scope-keep", role: "user", content: "keep" },
        { turnScopeId: "scope-delete", role: "assistant", content: "delete" },
      ],
      turnLifecycle: {
        sequence: 2,
        activeTurnScopeId: "",
        turns: {
          "scope-keep": {
            turnScopeId: "scope-keep",
            messageId: "message-keep",
            presentationMessageId: "presentation-keep",
            state: "completed",
            revision: 1,
            sequence: 1,
          },
          "scope-delete": {
            turnScopeId: "scope-delete",
            messageId: "message-delete",
            presentationMessageId: "presentation-delete",
            state: "stop_completed",
            revision: 2,
            sequence: 2,
          },
        },
      },
    },
  });

  await service.deleteFromMessage({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "scope-delete" },
    expectedAggregateVersion: 2,
    commandId: "delete-terminal-tail",
  });

  const persisted = getSession();
  const summary = buildSessionDisplaySummary(persisted);
  const lifecycle = await service.getTurnLifecycleSnapshot({
    userId: "u1",
    sessionId: "s1",
    commandId: "snapshot-after-delete",
  });
  assert.deepEqual(
    summary.messages.map((message) => message.turnScopeId),
    ["scope-keep"],
  );
  assert.deepEqual(
    summary.turnLifecycleSnapshot.recentTerminalTurns.map((turn) => turn.turnScopeId),
    ["scope-keep"],
  );
  assert.deepEqual(
    lifecycle.snapshot.recentTerminalTurns.map((turn) => turn.turnScopeId),
    ["scope-keep"],
  );
  assert.equal(persisted.turnLifecycle.turns["scope-delete"].state, "stop_completed");
});

test("SessionMessageService.deleteFromMessage returns 404 when anchor is missing", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      version: 1,
      messages: [{ turnScopeId: "scope-keep", role: "user", content: "keep" }],
    },
  });

  await assert.rejects(
    service.deleteFromMessage({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "missing" },
      commandId: "delete-missing",
    }),
    (error) => error?.statusCode === 404 && /anchor not found/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.deleteFromMessage rejects dialogProcessId legacy anchors", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      aggregateVersion: 1,
      messages: [
        { turnScopeId: "scope-keep", role: "user", content: "keep" },
        { dialogId: "dp-legacy", role: "assistant", content: "delete" },
        { turnScopeId: "scope-tail", role: "user", content: "delete too" },
      ],
    },
  });

  await assert.rejects(
    service.deleteFromMessage({
      userId: "u1",
      sessionId: "s1",
      anchor: { dialogProcessId: "dp-legacy" },
    }),
    (error) => error?.statusCode === 400 && /anchor is required/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test("SessionMessageService.deleteFromMessage returns 409 when expectedAggregateVersion conflicts", async () => {
  const { service, saved } = createService({
    initialSession: {
      sessionId: "s1",
      parentSessionId: "",
      aggregateVersion: 5,
      messages: [{ turnScopeId: "scope-keep", role: "user", content: "keep" }],
    },
  });

  await assert.rejects(
    service.deleteFromMessage({
      userId: "u1",
      sessionId: "s1",
      anchor: { turnScopeId: "scope-keep" },
      expectedAggregateVersion: 4,
      commandId: "delete-conflict",
    }),
    (error) => error?.statusCode === 409 && error?.currentVersion === 5,
  );
  assert.equal(saved.length, 0);
});
