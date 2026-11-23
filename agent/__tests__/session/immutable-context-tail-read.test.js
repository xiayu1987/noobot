/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { rename } from "node:fs/promises";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { upgradeImmutableContextIndexes } from "../../src/session/session-artifact-session/immutable-context-index-upgrade.js";
import { IMMUTABLE_CONTEXT_INDEX_VERSION } from "@noobot/session-protocol/immutable-storage-graph";
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";
import {
  CONTEXT_READ_LIMITS,
  CONTEXT_BUDGET_ERROR,
  CONTEXT_CANDIDATE_PAGE_SIZE,
} from "@noobot/session-protocol/context-read-budget";
import {
  invalid,
  message,
  fixture,
  commit,
  read,
  corrupt,
  assistantMessage,
} from "./immutable-context-tail-read.test-helpers.js";

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
  assert.deepEqual(orderReads, ["0000000000000010", "0000000000000001"]);
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
  ["missing root", { collection: "contextDialogRanges", key: "root", remove: true }],
  [
    "missing child page",
    {
      collection: "contextDialogRanges",
      key: "root",
      value: { slots: [0] },
    },
  ],
  [
    "unknown dialog ordinal",
    {
      collection: "contextDialogRanges",
      key: "root",
      value: { ordinals: [1, 2, 3] },
    },
  ],
  [
    "substituted dialog identity",
    {
      collection: "dialogOrder",
      key: "0000000000000002",
      value: "d-keep",
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

test("zero history window does not read the context directory", async (t) => {
  const store = await fixture(t);
  const snapshot = await corrupt(store, [
    { collection: "contextDialogRanges", key: "root", remove: true },
  ]);
  assert.deepEqual((await read(store, snapshot, { historyLimit: 0 })).messages, []);
});

test("cold context reads skip hundreds of empty dialogs with one directory leaf", async (t) => {
  const store = await fixture(t);
  await commit(store, "empty-dialogs", {
    messages: Array.from({ length: 512 }, (_, index) =>
      assistantMessage(`empty-dialog-${index}`, { summarized: true }),
    ),
  });
  const cold = await ImmutableSessionStore.open({ sessionDir: store.sessionDir });
  const snapshot = await cold.snapshot();
  const get = cold.get.bind(cold);
  let pages = 0;
  t.mock.method(cold, "get", (head, collection, key) => {
    if (collection === "contextDialogRanges") pages += 1;
    if (collection === "dialogs") assert.equal(key, "d-current");
    if (collection === "dialogTails") assert.fail("context must not traverse message tails");
    return get(head, collection, key);
  });
  const result = await read(cold, snapshot, {
    limits: { ...CONTEXT_READ_LIMITS, dialogs: 1 },
  });
  assert.deepEqual(
    result.messages.map(({ messageUid }) => messageUid),
    ["m-current"],
  );
  assert.equal(pages, 1);
});

test("directory removal, restoration and offline repair preserve snapshot reads", async (t) => {
  const store = await fixture(t);
  const answer = assistantMessage("candidate-dialog");
  await commit(store, "new-dialog", { messages: [answer] });
  const pinned = await store.snapshot();
  await commit(store, "empty-dialog", { messages: [{ ...answer, summarized: true }] });
  assert.equal((await read(store, await store.snapshot())).messages.at(-1).messageUid, "m-current");
  await commit(store, "restore-dialog", { messages: [{ ...answer, summarized: false }] });
  assert.equal(
    (await read(store, await store.snapshot())).messages.at(-1).messageUid,
    answer.messageUid,
  );
  const broken = await corrupt(store, [
    { collection: "contextDialogRanges", key: "root", remove: true },
    { collection: "contextDialogRanges", key: "ff", value: { slots: [1] } },
  ]);
  await assert.rejects(read(store, broken), invalid);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  const repaired = await store.snapshot();
  assert.equal((await read(store, repaired)).messages.at(-1).messageUid, answer.messageUid);
  assert.equal(await store.get(repaired, "contextDialogRanges", "ff"), null);
  assert.equal((await read(store, pinned)).messages.at(-1).messageUid, answer.messageUid);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  assert.deepEqual(await store.snapshot(), repaired);
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

for (const dimension of ["dialogs", "turns", "candidates"]) {
  test(`history ${dimension} budget is shared across dialogs without returning partial history`, async (t) => {
    const store = await fixture(t);
    const snapshot = await store.snapshot();
    await assert.rejects(
      read(store, snapshot, {
        historyLimit: 2,
        limits: { ...CONTEXT_READ_LIMITS, [dimension]: 1 },
      }),
      { code: CONTEXT_BUDGET_ERROR, dimension, used: 1, requested: 1 },
    );
    assert.deepEqual(await store.snapshot(), snapshot);
    assert.equal((await read(store, snapshot, { historyLimit: 2 })).messages.length, 2);
  });
}

test("history rejects an oversized turn before seeking or decoding any candidate page", async (t) => {
  const store = await fixture(t);
  await commit(store, "extra-candidate-budget", {
    messages: [{ ...message("extra"), dialogProcessId: "d-current", turnScopeId: "t-current" }],
  });
  const snapshot = await store.snapshot();
  const get = store.get.bind(store);
  t.mock.method(store, "get", (head, collection, key) => {
    if (collection === "contextCandidateRanges")
      assert.fail("over-budget turns must not seek candidate ranges");
    return get(head, collection, key);
  });
  t.mock.method(store.objects, "readValuesMetadata", () =>
    assert.fail("over-budget turns must not decode candidate metadata"),
  );
  await assert.rejects(
    read(store, snapshot, { limits: { ...CONTEXT_READ_LIMITS, candidates: 1 } }),
    { code: CONTEXT_BUDGET_ERROR, dimension: "candidates", used: 0, requested: 2 },
  );
  assert.deepEqual(await store.snapshot(), snapshot);
});

test("history candidate iteration shares one snapshot descriptor across bounded pages", async (t) => {
  const store = await fixture(t);
  const messages = Array.from({ length: CONTEXT_CANDIDATE_PAGE_SIZE + 1 }, (_, index) => ({
    ...message(`bounded-${index}`),
    dialogProcessId: "d-current",
    turnScopeId: "t-current",
  }));
  await commit(store, "bounded-pages", { messages });
  const snapshot = await store.snapshot();
  const get = store.get.bind(store);
  let descriptorReads = 0;
  t.mock.method(store, "get", (head, collection, key) => {
    if (collection === "contextSources") descriptorReads += 1;
    return get(head, collection, key);
  });
  const readMetadata = store.objects.readValuesMetadata.bind(store.objects);
  const batches = [];
  t.mock.method(store.objects, "readValuesMetadata", (references, options) => {
    batches.push(references.length);
    return readMetadata(references, options);
  });
  const source = await read(store, snapshot);
  assert.deepEqual(
    source.messages.map((item) => item.messageUid),
    ["m-current", ...messages.map((item) => item.messageUid)],
  );
  assert.equal(descriptorReads, 1);
  assert.deepEqual(batches, [CONTEXT_CANDIDATE_PAGE_SIZE, 2]);
});

test("context content budget rejects a large body before reading its descendants", async (t) => {
  const store = await fixture(t);
  await commit(store, "large-content", {
    messages: [{ ...message("current"), content: "large🙂".repeat(100000) }],
  });
  const snapshot = await store.snapshot();
  const originalRead = store.objects.readMany.bind(store.objects);
  let largestBatch = 0;
  t.mock.method(store.objects, "readMany", (references) => {
    largestBatch = Math.max(largestBatch, references.length);
    return originalRead(references);
  });
  await assert.rejects(read(store, snapshot, { limits: { ...CONTEXT_READ_LIMITS, bytes: 4096 } }), {
    code: CONTEXT_BUDGET_ERROR,
    dimension: "bytes",
  });
  assert.equal(largestBatch, 1, "body tree must not be expanded before the budget check");
  assert.deepEqual(await store.snapshot(), snapshot);
});

test("context rejects an understated candidate count before decoding excess records", async (t) => {
  const store = await fixture(t);
  const extra = { ...message("extra"), dialogProcessId: "d-current", turnScopeId: "t-current" };
  await commit(store, "extra-candidate", { messages: [extra] });
  const snapshot = await store.snapshot();
  const descriptor = await store.get(snapshot, "contextSources", "t-current");
  assert.equal(descriptor.count, 2);
  const get = store.get.bind(store);
  t.mock.method(store, "get", (head, collection, key) =>
    collection === "contextSources" && key === "t-current"
      ? { ...descriptor, count: 1 }
      : get(head, collection, key),
  );
  t.mock.method(store.objects, "readValuesMetadata", () =>
    assert.fail("excess candidate membership must fail before decoding"),
  );
  await assert.rejects(read(store, snapshot), invalid);
});

test("context reads one candidate turn without visiting hundreds of empty turns in its dialog", async (t) => {
  const store = await fixture(t);
  const empty = Array.from({ length: 512 }, (_, index) =>
    assistantMessage(`empty-${index}`, { dialogProcessId: "d-current", summarized: true }),
  );
  await commit(store, "empty-turns", { messages: empty });
  const snapshot = await store.snapshot();
  assert.equal((await store.get(snapshot, "dialogTurns", "d-current")).count, 513);
  assert.equal((await store.get(snapshot, "contextTurns", "d-current")).count, 1);
  const get = store.get.bind(store);
  let turnReads = 0;
  t.mock.method(store, "get", (head, collection, key) => {
    if (collection === "turns") {
      turnReads += 1;
      assert.equal(key, "t-current", "empty turn must not be read");
    }
    return get(head, collection, key);
  });
  const source = await read(store, snapshot, {
    limits: { ...CONTEXT_READ_LIMITS, turns: 1 },
  });
  assert.deepEqual(
    source.messages.map(({ messageUid }) => messageUid),
    ["m-current"],
  );
  assert.equal(turnReads, 1);
});

test("candidate turn projection follows last-candidate removal, restoration and suffix deletion", async (t) => {
  const store = await fixture(t);
  const answer = assistantMessage("answer", { dialogProcessId: "d-current" });
  await commit(store, "candidate-turn", { messages: [answer] });
  const pinned = await store.snapshot();
  assert.equal((await store.get(pinned, "contextTurns", "d-current")).count, 2);
  await commit(store, "summarized-turn", { messages: [{ ...answer, summarized: true }] });
  const summarized = await store.snapshot();
  assert.equal((await store.get(summarized, "contextTurns", "d-current")).count, 1);
  assert.equal((await read(store, pinned)).messages.at(-1).messageUid, answer.messageUid);
  assert.equal((await read(store, summarized)).messages.at(-1).messageUid, "m-current");
  await commit(store, "restore-turn", { messages: [{ ...answer, summarized: false }] });
  assert.equal((await store.get(await store.snapshot(), "contextTurns", "d-current")).count, 2);
  await commit(store, "delete-candidate-turn", {
    messageDeletion: {
      commandId: "delete-candidate-turn",
      anchor: { turnScopeId: answer.turnScopeId },
      expectedAggregateVersion: 0,
    },
  });
  assert.equal((await store.get(await store.snapshot(), "contextTurns", "d-current")).count, 1);
  await commit(store, "delete-dialog", {
    messageDeletion: {
      commandId: "delete-dialog",
      anchor: { turnScopeId: "t-current" },
      expectedAggregateVersion: 1,
    },
  });
  assert.equal(await store.get(await store.snapshot(), "contextTurns", "d-current"), null);
  assert.equal((await read(store, pinned)).messages.at(-1).messageUid, answer.messageUid);
});

test("missing candidate turn projection fails explicitly and offline repair restores it", async (t) => {
  const store = await fixture(t);
  const pinned = await store.snapshot();
  const expected = await read(store, pinned, { historyLimit: 2 });
  const broken = await corrupt(store, [
    { collection: "contextTurns", key: "d-current", remove: true },
    { collection: "contextTurns", key: "removed-dialog", value: { count: 0, root: null } },
  ]);
  await assert.rejects(read(store, broken), invalid);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  const repaired = await store.snapshot();
  assert.deepEqual(await read(store, repaired, { historyLimit: 2 }), expected);
  assert.equal(await store.get(repaired, "contextTurns", "removed-dialog"), null);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  assert.deepEqual(await store.snapshot(), repaired);
  assert.deepEqual(await read(store, pinned, { historyLimit: 2 }), expected);
});

test("candidate transitions reject inconsistent projection without publishing partial mutations", async (t) => {
  const store = await fixture(t);
  const answer = assistantMessage("answer", { dialogProcessId: "d-current" });
  await commit(store, "candidate-turn", { messages: [answer] });
  const broken = await corrupt(store, [
    { collection: "contextTurns", key: "d-current", value: { count: 0, root: null } },
  ]);
  await assert.rejects(
    commit(store, "remove-from-broken-projection", { messages: [{ ...answer, summarized: true }] }),
    invalid,
  );
  assert.deepEqual(await store.snapshot(), broken);
});

test("candidate turn identities share the byte budget before reading message metadata", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  t.mock.method(store.objects, "readValuesMetadata", () =>
    assert.fail("turn identity must exhaust its budget before reading messages"),
  );
  await assert.rejects(read(store, snapshot, { limits: { ...CONTEXT_READ_LIMITS, bytes: 1 } }), {
    code: CONTEXT_BUDGET_ERROR,
    dimension: "bytes",
    used: 0,
  });
  assert.deepEqual(await store.snapshot(), snapshot);
});

test("context rejects a turn substituted under another candidate identity in the same dialog", async (t) => {
  const store = await fixture(t);
  await commit(store, "second-turn", {
    messages: [assistantMessage("answer", { dialogProcessId: "d-current" })],
  });
  const snapshot = await store.snapshot();
  const substituted = await store.get(snapshot, "turns", "t-answer");
  const get = store.get.bind(store);
  t.mock.method(store, "get", (head, collection, key) =>
    collection === "turns" && key === "t-current" ? substituted : get(head, collection, key),
  );
  await assert.rejects(read(store, snapshot), invalid);
  assert.deepEqual(await store.snapshot(), snapshot);
});

test("legacy context indexes reject message writes and deletion until an offline upgrade", async (t) => {
  const store = await fixture(t);
  const snapshot = await store.snapshot();
  const facts = await store.get(snapshot, "metadata", "facts");
  const legacy = await corrupt(store, [
    {
      collection: "metadata",
      key: "facts",
      value: { ...facts, contextIndexVersion: IMMUTABLE_CONTEXT_INDEX_VERSION - 1 },
    },
  ]);
  const upgradeRequired = { code: "SESSION_IMMUTABLE_INDEX_UPGRADE_REQUIRED" };
  await assert.rejects(
    commit(store, "legacy-append", { messages: [message("new")] }),
    upgradeRequired,
  );
  await assert.rejects(
    commit(store, "legacy-delete", {
      messageDeletion: {
        commandId: "legacy-delete",
        anchor: { turnScopeId: "t-current" },
        expectedAggregateVersion: 0,
      },
    }),
    upgradeRequired,
  );
  assert.deepEqual(await store.snapshot(), legacy);
  await upgradeImmutableContextIndexes({ sessionDir: store.sessionDir });
  await commit(store, "legacy-append", { messages: [message("new")] });
  assert.equal((await read(store, await store.snapshot())).messages.at(-1).messageUid, "m-new");
});
