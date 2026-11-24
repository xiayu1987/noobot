/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { withProvisionedSessions } from "../helpers/provisioned-sessions.js";
import { commitTestSessionChanges } from "../helpers/session-services.js";

function message(messageUid, turnScopeId, dialogProcessId) {
  return {
    messageUid,
    userMessageId: `user-${messageUid}`,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId,
    parentDialogProcessId: "",
    turnScopeId,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: messageUid,
    attachments: [],
    transferEnvelopes: [],
    ts: "2026-01-01T00:00:00.000Z",
  };
}

test("appending to an earlier turn preserves later turns, message order and pinned reads", async () => {
  await withProvisionedSessions({ userId: "u1", sessionIds: ["s1"] }, async ({ runtime }) => {
    const repository = runtime.repositories.sessionRepository;
    const persistenceContext = repository.treePersistenceContext("u1", "s1");
    const read = () => repository.requireSessionReader("u1", "s1", { persistenceContext });
    const commit = (messages) =>
      commitTestSessionChanges(runtime, {
        userId: "u1",
        sessionId: "s1",
        changes: { messages },
      });
    const initial = [message("a", "a", "d1"), message("b", "b", "d1"), message("c", "c", "d2")];
    await commit(initial);
    await using before = await read();
    const laterPages = await Promise.all(
      ["b", "c"].map((turnScopeId) => before.readTurnPage({ turnScopeId })),
    );
    await commit([message("a-late", "a", "d1")]);
    await using after = await read();
    assert.equal(after.generation, before.generation + 1);
    assert.deepEqual(
      (await after.readTurnPage({ turnScopeId: "a" })).records.map(
        ({ message: item }) => item.messageUid,
      ),
      ["a", "a-late"],
    );
    assert.deepEqual(
      await Promise.all(["b", "c"].map((turnScopeId) => after.readTurnPage({ turnScopeId }))),
      laterPages.map((page) => ({ ...page, generation: after.generation })),
    );
    assert.deepEqual(await before.readMessages({ messageUids: ["a-late"] }), [null]);
    assert.deepEqual(
      (await before.readTurnPage({ turnScopeId: "a" })).records.map(
        ({ message: item }) => item.messageUid,
      ),
      ["a"],
    );
    await assert.rejects(commit([message("a", "c", "d2")]), {
      code: "SESSION_ENTITY_EXISTS",
    });
    {
      await using current = await read();
      assert.equal(current.generation, after.generation);
    }
    for (const scope of ["d", "e"]) await commit([message(scope, scope, `dialog-${scope}`)]);
    const restored = await repository.requireById("u1", "s1", { persistenceContext });
    assert.equal(restored.messages.length, 6);
    assert.deepEqual(
      new Set(restored.messages.map((item) => item.messageUid)),
      new Set(["a", "a-late", "b", "c", "d", "e"]),
    );
    await using current = await read();
    assert.equal((await current.readMessages({ messageUids: ["a-late"] }))[0].ordinal, 4);
  });
});
