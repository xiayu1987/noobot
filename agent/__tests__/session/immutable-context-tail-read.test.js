/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { commitSessionChanges } from "../../src/session/session-artifact-session/commit-session-changes.js";
import { readImmutableContextSource } from "../../src/session/session-artifact-session/immutable-context-reader.js";
import { upgradeImmutableContextIndexes } from "../../src/session/session-artifact-session/immutable-context-index-upgrade.js";
import { IMMUTABLE_CONTEXT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const ts = "2026-01-01T00:00:00.000Z";
const invalid = { code: "SESSION_IMMUTABLE_STORAGE_INVALID" };

function message(id) {
  return {
    messageUid: `m-${id}`,
    userMessageId: `u-${id}`,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: `d-${id}`,
    parentDialogProcessId: "",
    turnScopeId: `t-${id}`,
    role: "user",
    messageOrigin: "natural",
    type: "message",
    content: id,
    attachments: [],
    ts,
  };
}

async function fixture(t) {
  const sessionDir = await mkdtemp(path.join(tmpdir(), "immutable-context-tail-"));
  t.after(() => rm(sessionDir, { recursive: true, force: true }));
  const messages = [message("keep"), message("current")];
  await initializeImmutableSession({
    sessionDir,
    operationId: "initialize",
    session: {
      sessionId: "s1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      aggregateVersion: 0,
      messages,
      dialogOrder: messages.map((item, index) => ({
        dialogProcessId: item.dialogProcessId,
        turnScopeId: item.turnScopeId,
        userMessageUid: item.messageUid,
        dialogOrdinal: index + 1,
      })),
      turnTimings: [],
      sessionArtifactEvents: [],
      turnLifecycle: createEmptyTurnLifecycle(),
      createdAt: ts,
      updatedAt: ts,
    },
  });
  return new ImmutableSessionStore({ sessionDir, sessionId: "s1" });
}

async function commit(store, operationId, changes) {
  return commitSessionChanges({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
    expectedGeneration: (await store.snapshot()).generation,
    operationId,
    committedAt: ts,
    changes,
  });
}

function read(store, snapshot, options = {}) {
  return readImmutableContextSource({ store, snapshot, scope: {}, historyLimit: 1, ...options });
}

async function corrupt(store, changes) {
  await store.commit({
    expectedGeneration: (await store.snapshot()).generation,
    operationId: "corrupt",
    changes,
  });
  return store.snapshot();
}

test("cold history reads follow live dialogs after repeated deletion without scanning ordinal holes", async (t) => {
  const store = await fixture(t);
  const pinned = await store.snapshot();
  for (let index = 0; index < 8; index += 1) {
    await commit(store, `delete-${index}`, {
      messageDeletion: {
        commandId: `delete-${index}`,
        anchor: { turnScopeId: "t-current" },
        expectedAggregateVersion: index,
      },
    });
    await commit(store, `append-${index}`, { messages: [message("current")] });
  }
  const cold = new ImmutableSessionStore({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  const snapshot = await cold.snapshot();
  assert.equal((await cold.get(snapshot, "metadata", "facts")).dialogSequence, 10);
  const orderReads = [];
  const get = cold.get.bind(cold);
  t.mock.method(cold, "get", async (head, collection, key) => {
    if (collection === "dialogOrder") orderReads.push(key);
    return get(head, collection, key);
  });
  t.mock.method(cold, "entries", () => assert.fail("history must not enumerate collections"));
  const source = await read(cold, snapshot, {
    scope: { dialogProcessId: "d-current", turnScopeId: "t-current" },
  });
  assert.deepEqual(
    source.messages.map((item) => item.messageUid),
    ["m-keep"],
  );
  assert.deepEqual(orderReads, ["0000000000000010"]);
  assert.deepEqual(
    (await read(cold, pinned)).messages.map((item) => item.messageUid),
    ["m-current"],
  );
});

for (const [name, value] of [
  ["negative count", { count: -1, root: null }],
  ["fractional count", { count: 0.5, root: null }],
  ["nonempty index with zero count", { count: 0, root: "a".repeat(64) }],
  ["missing index with positive count", { count: 1, root: null }],
]) {
  test(`context reads reject ${name} through the shared storage graph contract`, async (t) => {
    const store = await fixture(t);
    const snapshot = await store.snapshot();
    await assert.rejects(
      corrupt(store, [{ collection: "dialogTurns", key: "d-current", value }]),
      invalid,
    );
    assert.deepEqual(await store.snapshot(), snapshot);
    const get = store.get.bind(store);
    t.mock.method(store, "get", (head, collection, key) =>
      collection === "dialogTurns" && key === "d-current" ? value : get(head, collection, key),
    );
    await assert.rejects(read(store, snapshot), invalid);
  });
}

for (const [name, change] of [
  ["missing membership", { collection: "dialogTurns", key: "d-current", remove: true }],
  [
    "empty membership",
    { collection: "dialogTurns", key: "d-current", value: { count: 0, root: null } },
  ],
]) {
  test(`live context dialogs reject ${name} instead of substituting older history`, async (t) => {
    const store = await fixture(t);
    const pinned = await store.snapshot();
    const snapshot = await corrupt(store, [change]);
    const get = store.get.bind(store);
    t.mock.method(store, "get", async (head, collection, key) => {
      assert.deepEqual(head, snapshot);
      if (collection === "dialogTurns" && key === "d-keep")
        assert.fail("corruption must not substitute an older dialog");
      return get(head, collection, key);
    });
    await assert.rejects(read(store, snapshot), invalid);
    t.mock.restoreAll();
    assert.deepEqual(
      (await read(store, pinned)).messages.map((item) => item.messageUid),
      ["m-current"],
    );
    assert.deepEqual(await store.snapshot(), snapshot);
  });
}

for (const [name, change] of [
  ["missing tail", { collection: "dialogTails", key: "d-current", remove: true }],
  [
    "wrong latest message",
    {
      collection: "dialogTails",
      key: "d-current",
      value: { messageUid: "m-keep", previousDialogProcessId: "d-keep", nextDialogProcessId: "" },
    },
  ],
  [
    "broken reverse link",
    {
      collection: "dialogTails",
      key: "d-keep",
      value: {
        messageUid: "m-keep",
        previousDialogProcessId: "",
        nextDialogProcessId: "unrelated",
      },
    },
  ],
  [
    "backward cycle",
    {
      collection: "dialogTails",
      key: "d-keep",
      value: {
        messageUid: "m-keep",
        previousDialogProcessId: "d-current",
        nextDialogProcessId: "d-current",
      },
    },
  ],
]) {
  test(`context reads reject ${name} without scanning for another history source`, async (t) => {
    const store = await fixture(t);
    const snapshot = await corrupt(store, [change]);
    await assert.rejects(read(store, snapshot, { historyLimit: 3 }), invalid);
    assert.deepEqual(await store.snapshot(), snapshot);
  });
}

test("zero history window does not traverse the dialog tail", async (t) => {
  const store = await fixture(t);
  const snapshot = await corrupt(store, [
    { collection: "dialogTails", key: "d-current", remove: true },
  ]);
  assert.deepEqual((await read(store, snapshot, { historyLimit: 0 })).messages, []);
});

test("candidate membership follows replacement and summary changes while old snapshots remain readable", async (t) => {
  const store = await fixture(t);
  const answer = {
    ...message("current"),
    messageUid: "answer",
    role: "assistant",
    modelMessageId: "model-answer",
    presentationMessageId: "answer-presentation",
  };
  delete answer.userMessageId;
  delete answer.messageOrigin;
  await commit(store, "answer", { messages: [answer] });
  const pinned = await store.snapshot();
  const membership = async (snapshot) => store.get(snapshot, "contextSources", "t-current");
  assert.equal((await membership(pinned)).count, 2);
  await commit(store, "summarize-answer", { messages: [{ ...answer, summarized: true }] });
  const summarized = await store.snapshot();
  assert.equal((await membership(summarized)).count, 1);
  assert.deepEqual(
    (await read(store, summarized)).messages.map(({ messageUid }) => messageUid),
    ["m-current"],
  );
  assert.deepEqual(
    (await read(store, pinned)).messages.map(({ messageUid }) => messageUid),
    ["m-current", "answer"],
  );
  await commit(store, "restore-answer", {
    messages: [{ ...answer, content: "replacement", summarized: false }],
  });
  const restored = await store.snapshot();
  assert.equal((await membership(restored)).count, 2);
  assert.equal((await read(store, restored)).messages.at(-1).content, "replacement");
});

test("offline candidate upgrade reconstructs membership from authoritative messages and is idempotent", async (t) => {
  const store = await fixture(t);
  const current = await store.snapshot();
  const expected = await read(store, current, { historyLimit: 2 });
  const facts = await store.get(current, "metadata", "facts");
  const legacy = await corrupt(store, [
    {
      collection: "metadata",
      key: "facts",
      value: { ...facts, contextIndexVersion: IMMUTABLE_CONTEXT_INDEX_VERSION - 1 },
    },
    { collection: "contextSources", key: "t-current", remove: true },
    { collection: "contextSources", key: "t-keep", remove: true },
  ]);
  await assert.rejects(read(store, legacy), { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" });
  await upgradeImmutableContextIndexes({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  const cold = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const upgraded = await cold.snapshot();
  assert.deepEqual(await read(cold, upgraded, { historyLimit: 2 }), expected);
  await upgradeImmutableContextIndexes({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  assert.deepEqual(await cold.snapshot(), upgraded);
});

test("offline repair restores missing membership even with a current version marker", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const expected = await read(store, snapshot, { historyLimit: 2 });
  await corrupt(store, [
    { collection: "contextSources", key: "t-current", remove: true },
    { collection: "contextSources", key: "t-keep", remove: true },
  ]);
  await upgradeImmutableContextIndexes({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  const cold = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const rebuilt = await cold.snapshot();
  assert.deepEqual(await read(cold, rebuilt, { historyLimit: 2 }), expected);
  await upgradeImmutableContextIndexes({
    sessionDir: store.sessionDir,
    sessionId: store.sessionId,
  });
  assert.deepEqual(await cold.snapshot(), rebuilt);
});

test("candidate reads reject count corruption instead of substituting another dialog", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const get = store.get.bind(store);
  t.mock.method(store, "get", async (head, collection, key) => {
    const value = await get(head, collection, key);
    return collection === "contextSources" && key === "t-current"
      ? { ...value, count: value.count + 1 }
      : value;
  });
  await assert.rejects(read(store, snapshot), invalid);
});

test("offline repair replaces incorrect current-version candidate membership and removes stale indexes", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const expected = await read(store, snapshot, { historyLimit: 2 });
  const wrongMembership = await store.get(snapshot, "contextSources", "t-keep");
  await corrupt(store, [
    { collection: "contextSources", key: "t-current", value: wrongMembership },
    { collection: "contextSources", key: "removed-turn", value: wrongMembership },
    { collection: "dialogTurns", key: "removed-dialog", value: { count: 0, root: null } },
    { collection: "dialogOrder", key: "0000000000000003", value: "removed-dialog" },
  ]);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  const repaired = await store.snapshot();
  assert.deepEqual(await read(store, repaired, { historyLimit: 2 }), expected);
  for (const [collection, key] of [
    ["contextSources", "removed-turn"],
    ["dialogTurns", "removed-dialog"],
    ["dialogOrder", "0000000000000003"],
  ])
    assert.equal(await store.get(repaired, collection, key), null);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  assert.deepEqual(await store.snapshot(), repaired);
});

test("failed context repair publication preserves the old head and retries the complete rebuild", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const expected = await read(store, snapshot, { historyLimit: 2 });
  const broken = await corrupt(store, [
    { collection: "contextSources", key: "t-current", remove: true },
    { collection: "contextSources", key: "t-keep", remove: true },
  ]);
  setFsAdapter({
    rename: async (from, target) => {
      if (target === store.headPath)
        throw Object.assign(new Error("repair head fault"), { code: "EIO" });
      return rename(from, target);
    },
  });
  try {
    await assert.rejects(upgradeImmutableContextIndexes({ sessionDir: store.sessionDir }), {
      code: "SESSION_COMMIT_UNCERTAIN",
    });
  } finally {
    resetFsAdapter();
  }
  assert.deepEqual(await store.snapshot(), broken);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  assert.deepEqual(await read(store, await store.snapshot(), { historyLimit: 2 }), expected);
  assert.deepEqual(await read(store, snapshot, { historyLimit: 2 }), expected);
});
