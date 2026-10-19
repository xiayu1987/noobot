/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import assert from "node:assert/strict";

import { SessionMessageService } from "../../src/session/services/session-message-service.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import { createTestSessionRequiredFields } from "../helpers/session-message-facts.js";

const TEST_SESSION_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "noobot-session-dir-"));
after(() => fs.rmSync(TEST_SESSION_DIR, { recursive: true, force: true }));

function createService({ initialSession }) {
  const saved = [];
  let currentSession = structuredClone({
    ...createTestSessionRequiredFields(),
    aggregateVersion: 0,
    ...initialSession,
  });
  const sessionRepo = {
    async resolveSessionScope() {
      return {
        resolvedParentSessionId: currentSession?.parentSessionId || "",
        sessionDir: TEST_SESSION_DIR,
      };
    },
    async withSessionMutation(_u, _s, _p, operation) {
      return operation();
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
      ...createTestSessionRequiredFields(),
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
      ...createTestSessionRequiredFields(),
      sessionId: "s1",
      aggregateVersion: 2,
      messages: [
        { turnScopeId: "scope-keep", role: "user", content: "keep" },
        { turnScopeId: "scope-delete", role: "assistant", content: "delete" },
      ],
      turnLifecycle: {
        ...createEmptyTurnLifecycle(),
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
        commandReceipts: [
          {
            commandId: "keep-completed",
            type: "turn.completed",
            turnScopeId: "scope-keep",
            requestHash: "keep",
          },
          {
            commandId: "delete-stopped",
            type: "turn.stop_completed",
            turnScopeId: "scope-delete",
            requestHash: "delete",
          },
        ],
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
    knownSequence: 0,
    terminalLimit: 10,
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
  assert.deepEqual(Object.keys(persisted.turnLifecycle.turns), ["scope-keep"]);
  assert.deepEqual(
    persisted.turnLifecycle.commandReceipts.map((receipt) => [receipt.type, receipt.turnScopeId]),
    [
      ["turn.completed", "scope-keep"],
      ["session.message.delete_from", undefined],
    ],
  );
});

test("SessionMessageService.deleteFromMessage clears a survivor's reference to the deleted source", async () => {
  const initialSession = {
    ...createTestSessionRequiredFields(),
    sessionId: "s1",
    aggregateVersion: 2,
    messages: [
      { turnScopeId: "continuation", role: "assistant", content: "continuation" },
      { turnScopeId: "source", role: "user", content: "source" },
    ],
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
      sequence: 2,
      turns: {
        source: {
          turnScopeId: "source",
          dialogProcessId: "source-dialog",
          state: "stop_completed",
          sequence: 1,
        },
        continuation: {
          turnScopeId: "continuation",
          dialogProcessId: "continuation-dialog",
          state: "completed",
          sequence: 2,
          continuationSource: {
            turnScopeId: "source",
            dialogProcessId: "source-dialog",
          },
        },
      },
      commandReceipts: [],
    },
  };
  const { service, saved, getSession } = createService({ initialSession });

  const result = await service.deleteFromMessage({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "source" },
    expectedAggregateVersion: 2,
    commandId: "delete-continuation-source",
  });

  assert.deepEqual(result.deletedTurnScopeIds, ["source"]);
  assert.equal(saved.length, 1);
  const after = getSession();
  assert.deepEqual(Object.keys(after.turnLifecycle.turns), ["continuation"]);
  assert.equal(after.turnLifecycle.turns.continuation.continuationSource, null);
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
      ...createTestSessionRequiredFields(),
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
      ...createTestSessionRequiredFields(),
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

test("SessionMessageService.deleteFromMessage prunes write-time dialog facts of truncated turns", async () => {
  const receipt = (checkpointId, uids) => ({
    checkpointId,
    requestHash: `sha256:${checkpointId}`,
    persistedMessageUids: uids,
    summarizedMessageUids: uids,
  });
  const { service, saved } = createService({
    initialSession: {
      ...createTestSessionRequiredFields(),
      sessionId: "s1",
      parentSessionId: "",
      aggregateVersion: 1,
      autoTitle: "stale title",
      messages: [
        {
          messageUid: "k1",
          dialogProcessId: "d-keep",
          turnScopeId: "t-keep",
          role: "user",
          content: "kept question",
        },
        { messageUid: "x1", dialogProcessId: "d-drop", turnScopeId: "t-drop", role: "user" },
      ],
      dialogOrder: [
        {
          dialogProcessId: "d-keep",
          turnScopeId: "t-keep",
          userMessageUid: "k1",
          dialogOrdinal: 1,
        },
        {
          dialogProcessId: "d-drop",
          turnScopeId: "t-drop",
          userMessageUid: "x1",
          dialogOrdinal: 2,
        },
      ],
      turnSummaryCheckpoints: {
        "t-keep": {
          dialogProcessId: "d-keep",
          turnScopeId: "t-keep",
          receipts: [receipt("keep", ["k1"]), receipt("cross", ["k1", "x1"])],
        },
        "t-drop": {
          dialogProcessId: "d-drop",
          turnScopeId: "t-drop",
          receipts: [receipt("drop", ["x1"])],
        },
      },
    },
  });

  await service.deleteFromMessage({
    userId: "u1",
    sessionId: "s1",
    anchor: { turnScopeId: "t-drop" },
    expectedAggregateVersion: 1,
    commandId: "delete-dialog-facts",
  });

  assert.deepEqual(
    saved[0].dialogOrder.map((entry) => entry.dialogProcessId),
    ["d-keep"],
  );
  assert.equal(saved[0].autoTitle, "kept question");
  assert.deepEqual(Object.keys(saved[0].turnSummaryCheckpoints), ["t-keep"]);
  assert.deepEqual(
    saved[0].turnSummaryCheckpoints["t-keep"].receipts.map((item) => item.checkpointId),
    ["keep"],
  );
});
