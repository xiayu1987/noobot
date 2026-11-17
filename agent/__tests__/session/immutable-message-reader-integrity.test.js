/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { registerDialogOrderMessage } from "../../src/session/entities/dialog-order-entity.js";
import {
  readImmutableMessage,
  readImmutableTurnAnchor,
  readImmutableTurnPage,
} from "../../src/session/session-artifact-session/immutable-message-reader.js";
import { readImmutableMessageTailPage } from "../../src/session/session-artifact-session/immutable-message-range.js";
import { readImmutableTurnView } from "../../src/session/session-artifact-session/immutable-turn-view.js";

const ts = "2026-01-01T00:00:00.000Z";
async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-message-reader-integrity-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const message = {
    messageUid: "m1",
    userMessageId: "u1",
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: "hello",
    attachments: [],
    ts,
  };
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages: [message],
      dialogOrder: registerDialogOrderMessage([], message),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}

const readers = {
  uid: (store, snapshot) => readImmutableMessage(store, snapshot, "m1"),
  anchor: (store, snapshot) => readImmutableTurnAnchor({ store, snapshot, turnScopeId: "t1" }),
  page: (store, snapshot) =>
    readImmutableTurnPage({ store, snapshot, turnScopeId: "t1", limit: 1 }),
  tail: (store, snapshot) =>
    readImmutableMessageTailPage({ store, snapshot, turnScopeId: "t1", limit: 1 }),
  view: async (store, snapshot) => {
    const view = await readImmutableTurnView({ store, snapshot, turnScopeIds: ["t1"] });
    return { records: view.session.messages.map((message) => ({ message })) };
  },
};
const invalidMessages = {
  content: { content: null },
  attachments: { attachments: {} },
  timestamp: { ts: "invalid" },
  origin: { messageOrigin: "unknown" },
  toolCalls: { type: "tool_call", tool_calls: [] },
};

for (const [field, overrides] of Object.entries(invalidMessages)) {
  test(`all local readers reject hash-valid messages with invalid ${field}`, async (t) => {
    const store = await fixture(t);
    const before = await store.snapshot();
    const record = await store.get(before, "messages", "m1");
    const invalid = { ...record, message: { ...record.message, ...overrides } };
    const turn = await store.get(before, "turns", "t1");
    await store.transact({
      expectedGeneration: before.generation,
      operationId: "inject-corruption",
      input: invalid,
      prepare: async ({ input }) => {
        turn.messagesRoot = await store.index.set(
          turn.messagesRoot,
          "m1",
          await store.putCollectionValue("messages", "m1", input),
        );
        return {
          changes: [
            { collection: "messages", key: "m1", value: input },
            { collection: "turns", key: "t1", value: turn },
          ],
        };
      },
    });
    const snapshot = await store.snapshot();
    for (const read of Object.values(readers)) {
      await assert.rejects(read(store, snapshot), (error) => {
        assert.equal(error.code, "SESSION_IMMUTABLE_STORAGE_INVALID");
        assert.equal(error.cause?.code, "SESSION_MESSAGE_ENTITY_INVALID");
        return true;
      });
      const old = await read(store, before);
      assert.equal((old.records?.[0] ?? old).message.content, "hello");
    }
    assert.deepEqual(await store.snapshot(), snapshot);
  });
}

test("local message validation uses the supplied snapshot and performs no extra reads", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const get = store.get.bind(store);
  const calls = [];
  store.get = async (head, collection, key) => {
    assert.strictEqual(head, snapshot);
    calls.push([collection, key]);
    return get(head, collection, key);
  };
  const record = await readImmutableMessage(store, snapshot, "m1");
  assert.equal(record.message.content, "hello");
  assert.deepEqual(calls, [
    ["messages", "m1"],
    ["lifecycle", "t1"],
  ]);
  calls.length = 0;
  const page = await readers.page(store, snapshot);
  assert.deepEqual(page.records, [record]);
  assert.deepEqual(calls, [
    ["turns", "t1"],
    ["lifecycle", "t1"],
  ]);
});
