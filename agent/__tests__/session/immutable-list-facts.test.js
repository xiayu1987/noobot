/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { readImmutableListProjection } from "../../src/session/session-artifact-session/immutable-list-projection.js";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";

test("list reads only the authoritative facts and the selected message", async () => {
  const calls = [];
  const value = await readImmutableListProjection(async (collection, key) => {
    calls.push([collection, key]);
    if (collection === "metadata" && key === "facts")
      return { messageCount: 10, lastMessageUid: "last" };
    if (collection === "messages" && key === "last")
      return {
        message: {
          messageUid: "last",
          sessionId: "list",
          role: "assistant",
          content: "latest",
          modelMessageId: "model-last",
          presentationMessageId: "presentation-last",
        },
      };
    throw new Error(`Unexpected list dependency: ${collection}/${key}`);
  });
  assert.equal(value.messageCount, 10);
  assert.equal(value.lastMessage.content, "latest");
  assert.deepEqual(calls, [
    ["metadata", "facts"],
    ["messages", "last"],
  ]);
});

test("empty lists require no message or projection read", async () => {
  const calls = [];
  const value = await readImmutableListProjection(async (collection, key) => {
    calls.push([collection, key]);
    assert.deepEqual([collection, key], ["metadata", "facts"]);
    return { messageCount: 0, lastMessageUid: "" };
  });
  assert.deepEqual(value, { messageCount: 0, lastMessage: null });
  assert.equal(calls.length, 1);
});

for (const facts of [
  null,
  {},
  { messageCount: -1, lastMessageUid: "" },
  { messageCount: 0, lastMessageUid: "unexpected" },
  { messageCount: 1, lastMessageUid: "" },
]) {
  test(`invalid list facts reject before fetching a message: ${JSON.stringify(facts)}`, async () => {
    await assert.rejects(
      readImmutableListProjection(async (collection) => {
        assert.equal(collection, "metadata");
        return facts;
      }),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
  });
}

for (const record of [null, { message: { messageUid: "foreign" } }]) {
  test(`missing or foreign last message rejects: ${JSON.stringify(record)}`, async () => {
    await assert.rejects(
      readImmutableListProjection(async (collection) =>
        collection === "metadata" ? { messageCount: 1, lastMessageUid: "last" } : record,
      ),
      { code: "SESSION_IMMUTABLE_STORAGE_INVALID" },
    );
  });
}

test("initialization and message updates publish no duplicate list body", async (t) => {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-list-facts-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const ts = "2026-01-01T00:00:00.000Z";
  await initializeImmutableSession({
    sessionDir,
    operationId: "seed",
    session: {
      sessionId: "list",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages: [],
      dialogOrder: [],
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  const store = await ImmutableSessionStore.open({ sessionDir });
  assert.equal(await store.get(await store.snapshot(), "metadata", "listProjection"), null);
  const message = {
    messageUid: "m",
    userMessageId: "m",
    sessionId: "list",
    parentSessionId: "",
    dialogProcessId: "d",
    parentDialogProcessId: "",
    turnScopeId: "t",
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: "body".repeat(100000),
    attachments: [],
    transferEnvelopes: [],
    ts,
  };
  await commitSessionChanges({
    sessionDir,
    sessionId: "list",
    expectedGeneration: 1,
    operationId: "append",
    changes: { messages: [message] },
    committedAt: ts,
  });
  const snapshot = await store.snapshot();
  assert.equal(await store.get(snapshot, "metadata", "listProjection"), null);
  const list = await readImmutableListProjection((collection, key) =>
    store.get(snapshot, collection, key),
  );
  assert.equal(list.messageCount, 1);
  assert.equal(list.lastMessage.content, message.content);
});
