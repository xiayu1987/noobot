/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildHarness } from "./scoped-session-repositories.fixtures.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

const treeContext = (sessionRepo, sessionId) => ({
  persistenceContext: sessionRepo.treePersistenceContext("alice", sessionId),
});

test("concurrent deltas reject stale generations and preserve unrelated turns on retry", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  try {
    const sessionId = "concurrent-turn-journals";
    const keep = {
      attachments: [],
      messageUid: "keep-message",
      ts: TEST_MESSAGE_TS,
      sessionId,
      role: "user",
      messageOrigin: "natural",
      content: "keep",
      dialogProcessId: "dialog-keep",
      turnScopeId: "turn-keep",
    };
    const replaced = {
      attachments: [],
      messageUid: "replaced-message",
      ts: TEST_MESSAGE_TS,
      sessionId,
      role: "assistant",
      presentationMessageId: "pm_replaced",
      modelMessageId: "mm_replaced",
      content: "replaced",
      dialogProcessId: "dialog-replaced",
      turnScopeId: "turn-replaced",
    };
    const context = treeContext(sessionRepo, sessionId);
    await sessionRepo.ensureSession({
      userId: "alice",
      sessionId,
      parentSessionId: "",
      caller: "user",
      ...context,
    });
    const reader = () => sessionRepo.requireSessionReader("alice", sessionId, context);
    const prepare = (reader, operationId, messages) =>
      reader.prepareRequest({ operationId, committedAt: TEST_MESSAGE_TS, changes: { messages } });
    const submit = (run) => sessionRepo.withSessionReader("alice", sessionId, run, context);
    const commit = (operationId, messages) =>
      submit(async ({ reader, commitChanges }) =>
        commitChanges(await prepare(reader, operationId, messages)),
      );
    await commit("seed", [keep, replaced]);
    await using pinned = await reader();

    const replacement = (suffix) => ({
      attachments: [],
      messageUid: `replacement-${suffix}`,
      ts: TEST_MESSAGE_TS,
      sessionId,
      role: "assistant",
      presentationMessageId: `pm_${suffix}`,
      modelMessageId: `mm_${suffix}`,
      content: `replacement-${suffix}`,
      dialogProcessId: `dialog-${suffix}`,
      turnScopeId: `turn-${suffix}`,
    });
    const requests = await Promise.all(
      ["a", "b"].map((suffix) => prepare(pinned, `append-${suffix}`, [replacement(suffix)])),
    );
    const outcomes = await Promise.allSettled(
      requests.map((request) => submit(({ commitChanges }) => commitChanges(request))),
    );
    assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
    const loser = outcomes.findIndex((item) => item.status === "rejected");
    assert.equal(outcomes[loser].reason.code, "SESSION_OPERATION_CONFLICT");
    const suffix = ["a", "b"][loser];
    await commit(`retry-${suffix}`, [replacement(suffix)]);
    const restored = await sessionRepo.requireById("alice", sessionId, context);
    assert.deepEqual(
      new Set(restored.messages.map((item) => item.messageUid)),
      new Set(["keep-message", "replaced-message", "replacement-a", "replacement-b"]),
    );
    assert.deepEqual(
      (await pinned.exportSession()).messages.map((item) => item.messageUid),
      ["keep-message", "replaced-message"],
    );
    await using current = await reader();
    for (const turnScopeId of ["turn-keep", "turn-replaced", "turn-a", "turn-b"]) {
      const page = await current.readTurnPage({ turnScopeId, limit: 1 });
      assert.equal(page.records.length, 1);
      assert.equal(page.hasMore, false);
      assert.equal(page.records[0].message.turnScopeId, turnScopeId);
    }
  } finally {
    await harness.cleanup();
  }
});

test("session creation rejects parent identity conflicts without changing the committed child", async () => {
  const harness = buildHarness();
  const { sessionRepo } = await harness.setup();
  try {
    await sessionRepo.ensureSession({
      userId: "alice",
      sessionId: "p1",
      parentSessionId: "",
      caller: "user",
      ...treeContext(sessionRepo, "p1"),
    });
    await sessionRepo.ensureSession({
      userId: "alice",
      sessionId: "child",
      parentSessionId: "p1",
      caller: "user",
      ...treeContext(sessionRepo, "child"),
    });
    for (const conflictingParent of ["p2", ""]) {
      await assert.rejects(
        sessionRepo.ensureSession({
          userId: "alice",
          sessionId: "child",
          parentSessionId: conflictingParent,
          caller: "user",
          ...treeContext(sessionRepo, "child"),
        }),
        { code: "FATAL_PARENT_SESSION_MISSING" },
      );
    }
    const childScope = await sessionRepo.requireSessionScope(
      "alice",
      "child",
      treeContext(sessionRepo, "child").persistenceContext,
    );
    assert.equal(childScope.resolvedParentSessionId, "p1");
    await using child = await sessionRepo.requireSessionReader(
      "alice",
      "child",
      treeContext(sessionRepo, "child"),
    );
    assert.equal((await child.readMetadata()).parentSessionId, "p1");
    assert.equal(sessionRepo.save, undefined);
    assert.equal(sessionRepo.saveTurnView, undefined);
  } finally {
    await harness.cleanup();
  }
});
