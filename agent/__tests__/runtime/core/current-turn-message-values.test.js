/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";

test("current turn captures immutable JSON values at the explicit mutation boundary", () => {
  let value = "before";
  const values = [undefined, NaN, Infinity, -0, undefined, null];
  delete values[4];
  const source = {
    messageUid: "m1",
    metadata: {
      date: new Date(0),
      map: new Map([["key", "value"]]),
      values,
      custom: {
        toJSON() {
          return value;
        },
      },
      get dynamic() {
        return value;
      },
    },
  };
  const store = createCurrentTurnMessagesStore([source]);
  const admitted = JSON.stringify([source]);
  assert.notEqual(store.toArray()[0], source);
  assert.notEqual(store.toArray()[0].metadata, source.metadata);
  value = "after";
  source.metadata.date.setTime(1);
  assert.equal(JSON.stringify(store.readSnapshot()), admitted);
  assert.equal(store.toArray()[0].metadata.custom, "before");
  assert.equal(store.toArray()[0].metadata.date, new Date(0).toJSON());
  assert.throws(() => store.toArray()[0].metadata.values.push(1), TypeError);
  assert.throws(() => {
    store.readByUid("m1").metadata.dynamic = "consumer";
  }, TypeError);
  const copy = store.toArray();
  copy[0].content = "consumer";
  assert.equal(store.toArray()[0].content, undefined);
  const snapshot = store.readSnapshot();
  store.updateLast({ content: "updated" });
  assert.equal(snapshot[0].content, undefined);
  assert.equal(store.toArray()[0].content, "updated");
  assert.throws(() => snapshot.push(source), TypeError);
});

test("metadata patches never serialize the retained body or enqueue no-op revisions", (t) => {
  const body = { parts: Array.from({ length: 1024 }, () => "retained".repeat(128)) };
  const store = createCurrentTurnMessagesStore([{ messageUid: "m1", content: body }]);
  store.acknowledgeChanges(store.readPendingChanges().entries);
  const capturedBody = store.readByUid("m1").content;
  const stringify = JSON.stringify;
  let serializedBytes = 0;
  const serialize = t.mock.method(JSON, "stringify", function (value, ...args) {
    assert.notEqual(value, capturedBody, "unchanged body was serialized");
    assert.equal(Object.hasOwn(value ?? {}, "content"), false, "whole message was serialized");
    const result = stringify(value, ...args);
    serializedBytes += result?.length ?? 0;
    return result;
  });
  try {
    for (let index = 0; index < 32; index += 1)
      store.updateByUid("m1", { summarized: index % 2 === 0 });
    const pending = store.readPendingChanges().entries;
    store.updateByUid("m1", { summarized: false, missing: undefined });
    assert.equal(store.readPendingChanges().entries[0].revision, pending[0].revision);
    assert.equal(store.readByUid("m1").content, capturedBody);
    store.acknowledgeChanges(pending);
    assert.deepEqual(store.readPendingChanges().entries, []);
  } finally {
    serialize.mock.restore();
  }
  assert.ok(serializedBytes < 2048, `metadata serialized ${serializedBytes} bytes`);
});

test("invalid identities and updater failures never partially change the store", () => {
  const store = createCurrentTurnMessagesStore([{ messageUid: "m1" }, { messageUid: "m2" }]);
  const expected = store.toArray();
  for (const change of [
    () => store.push({ messageUid: "m2" }),
    () => store.updateLast({ messageUid: "m1" }),
    () => store.replaceAll([{ messageUid: "m3" }, { messageUid: "m3" }]),
    () =>
      store.updateWhere({ content: "partial" }, (_, index) => {
        if (index === 1) throw new Error("matcher failed");
        return true;
      }),
  ]) {
    assert.throws(change);
    assert.deepEqual(store.toArray(), expected);
  }
  store.push({ messageUid: "m3" });
  store.updateLast({ messageUid: "m4" });
  store.push({ messageUid: "m3" });
  assert.deepEqual(
    store.toArray().map(({ messageUid }) => messageUid),
    ["m1", "m2", "m4", "m3"],
  );
});

test("indexed updates preserve admission, replacement and atomic batch semantics", () => {
  const store = createCurrentTurnMessagesStore([{ messageUid: "m1" }, { messageUid: "m2" }]);
  assert.equal(store.updateByUid("missing", { content: "ignored" }), null);
  assert.throws(() => store.updateByUid("m2", { messageUid: "m1" }));
  assert.deepEqual(store.readByUid("m2"), { messageUid: "m2" });
  store.updateByUid("m2", { messageUid: "renamed", content: "changed" });
  assert.equal(store.readByUid("m2"), null);
  const copy = store.readByUid("renamed");
  copy.content = "consumer";
  assert.equal(store.readByUid("renamed").content, "changed");
  store.updateWhere({ content: "batch" });
  assert.equal(store.readByUid("renamed").content, "batch");
  assert.throws(() => store.updateWhere({ messageUid: "duplicate" }));
  assert.equal(store.readByUid("renamed").content, "batch");
  store.replaceAll([{ messageUid: "m3" }]);
  assert.equal(store.readByUid("renamed"), null);
  store.updateByUid("m3", { content: "replacement" });
  assert.deepEqual(store.toArray(), [{ messageUid: "m3", content: "replacement" }]);
});

test("indexed updates and last-message patches do not inspect unrelated records", () => {
  const store = createCurrentTurnMessagesStore(
    Array.from({ length: 1024 }, (_, index) => ({ messageUid: `m${index}` })),
  );
  const unrelated = store.push({ messageUid: "unrelated" });
  store.push({ messageUid: "last" });
  Object.defineProperty(unrelated, "messageUid", {
    get() {
      throw new Error("unrelated identity was visited");
    },
  });
  assert.equal(store.updateByUid("m0", { content: "indexed" }).content, "indexed");
  assert.equal(store.updateLast({ content: "tail" }).content, "tail");
  assert.throws(
    () =>
      store.updateByUid("m0", {
        get content() {
          throw new Error("patch getter failed");
        },
      }),
    /patch getter failed/,
  );
  assert.equal(store.readByUid("m0").content, "indexed");
});

test("assistant model identity lookup follows updates, duplicates and batch replacement", () => {
  const store = createCurrentTurnMessagesStore([
    { messageUid: "user", role: "user", modelMessageId: "model" },
    { messageUid: "first", role: "assistant", modelMessageId: "model" },
    { messageUid: "second", role: "assistant", modelMessageId: "model" },
  ]);
  assert.equal(store.readAssistantByModelMessageId("model").messageUid, "first");
  store.updateByUid("first", { modelMessageId: "other" });
  assert.equal(store.readAssistantByModelMessageId("model").messageUid, "second");
  store.updateByUid("first", { modelMessageId: "model" });
  assert.equal(store.readAssistantByModelMessageId("model").messageUid, "first");
  store.updateWhere({ role: "tool" }, (item) => item.messageUid === "first");
  assert.equal(store.readAssistantByModelMessageId("model").messageUid, "second");
  assert.throws(() => store.updateByUid("second", { messageUid: "user" }));
  assert.equal(store.readAssistantByModelMessageId("model").messageUid, "second");
  store.replaceAll([]);
  assert.equal(store.readAssistantByModelMessageId("model"), null);
  store.push({ messageUid: "replacement", role: "assistant", modelMessageId: "model" });
  assert.equal(store.readAssistantByModelMessageId("model").messageUid, "replacement");
});

test("model identity lookup preserves duplicate order without accessing unrelated records", () => {
  const store = createCurrentTurnMessagesStore([
    { messageUid: "user", role: "user", modelMessageId: "shared" },
    { messageUid: "first", role: "assistant", modelMessageId: "shared" },
    { messageUid: "second", role: "assistant", modelMessageId: "shared" },
  ]);
  const unrelated = store.push({ messageUid: "unrelated", modelMessageId: "unrelated" });
  Object.defineProperty(unrelated, "modelMessageId", {
    get() {
      throw new Error("unrelated model identity was visited");
    },
  });
  const matchingUids = () =>
    store.readMessagesByModelMessageId("shared").map((item) => item.messageUid);
  assert.deepEqual(matchingUids(), ["user", "first", "second"]);
  store.updateByUid("first", { modelMessageId: "other" });
  assert.deepEqual(matchingUids(), ["user", "second"]);
  store.updateByUid("first", { modelMessageId: "shared" });
  assert.deepEqual(matchingUids(), ["user", "first", "second"]);
  assert.deepEqual(store.readMessagesByModelMessageId("missing"), []);
  const copy = store.readMessagesByModelMessageId("shared");
  copy[0].content = "consumer";
  assert.equal(store.readByUid("user").content, undefined);
  assert.deepEqual(store.readCounts(), { messageCount: 4, assistantCount: 2, toolCount: 0 });
});

test("presentation demotion visits only the indexed Turn and tracks its delta", () => {
  const store = createCurrentTurnMessagesStore();
  const prefix = [];
  for (let index = 0; index < 1024; index += 1) {
    prefix.push(store.push({ messageUid: `prefix-${index}`, role: "tool" }));
  }
  const presentation = (messageUid, turnScopeId) => ({
    messageUid,
    role: "assistant",
    type: "message",
    chatPresentation: true,
    presentationMessageId: `presentation-${turnScopeId}`,
    turnScopeId,
    dialogProcessId: "dialog",
    workspaceRootDirectory: "/workspace",
  });
  store.push(presentation("other", "other"));
  store.push(presentation("current", "current"));
  store.acknowledgeChanges(store.readPendingChanges().entries);
  for (const previous of prefix) {
    Object.defineProperty(previous, "role", {
      get() {
        throw new Error("committed prefix was visited");
      },
    });
  }
  assert.equal(store.demoteAssistantPresentation("missing"), 0);
  assert.equal(store.demoteAssistantPresentation("current"), 1);
  assert.equal(store.demoteAssistantPresentation("current"), 0);
  assert.equal(store.readByUid("other").chatPresentation, true);
  assert.equal(store.readByUid("current").chatPresentation, false);
  assert.equal(Object.hasOwn(store.readByUid("current"), "workspaceRootDirectory"), false);
  assert.deepEqual(
    store.readPendingChanges().entries.map((entry) => entry.messageUid),
    ["current"],
  );
  store.updateByUid("current", { chatPresentation: true });
  assert.equal(store.demoteAssistantPresentation("current"), 1);
  const replacementStore = createCurrentTurnMessagesStore([presentation("initial", "current")]);
  replacementStore.replaceAll([presentation("replacement", "current")]);
  assert.equal(replacementStore.demoteAssistantPresentation("current"), 1);
});

test("committed eviction touches only selected records and does not enqueue durable deletions", () => {
  const store = createCurrentTurnMessagesStore();
  const unrelated = [];
  for (let index = 0; index < 1024; index += 1) {
    unrelated.push(store.push({ messageUid: `prefix-${index}`, role: "tool" }));
  }
  store.push({ messageUid: "selected", role: "assistant", modelMessageId: "selected-model" });
  store.acknowledgeChanges(store.readPendingChanges().entries);
  store.push({ messageUid: "pending", role: "user" });
  for (const message of unrelated) {
    Object.defineProperty(message, "role", {
      get() {
        throw new Error("unrelated committed prefix was visited");
      },
    });
  }
  assert.deepEqual(store.evictCommittedByUids(["missing", "selected", "selected"]), [
    { messageUid: "selected", role: "assistant", modelMessageId: "selected-model" },
  ]);
  assert.equal(store.readByUid("selected"), null);
  assert.deepEqual(store.readMessagesByModelMessageId("selected-model"), []);
  assert.equal(store.readFinalAssistant(), null);
  assert.deepEqual(store.readCounts(), { messageCount: 1025, assistantCount: 0, toolCount: 1024 });
  assert.deepEqual(
    store.readPendingChanges().entries.map((entry) => entry.messageUid),
    ["pending"],
  );
  assert.equal(store.updateLast({ content: "tail" }).messageUid, "pending");
});

test("eviction preserves order, indexes and dense batch matcher positions across holes", () => {
  const store = createCurrentTurnMessagesStore([
    { messageUid: "a", role: "assistant", summarized: true, attachments: [{ id: "a" }] },
    { messageUid: "b", role: "tool" },
    { messageUid: "c", role: "assistant", modelMessageId: "model" },
    { messageUid: "d", role: "assistant", modelMessageId: "model", summarized: true },
  ]);
  store.acknowledgeChanges(store.readPendingChanges().entries);
  assert.deepEqual(
    store.evictCommittedByUids(["d", "a"]).map((item) => item.messageUid),
    ["a", "d"],
  );
  assert.deepEqual(
    store.readArtifactProjectionSources().map((item) => item.messageUid),
    ["c"],
  );
  assert.equal(store.readAssistantByModelMessageId("model").messageUid, "c");
  assert.equal(store.updateLast({ content: "last" }).messageUid, "c");
  store.updateWhere({ content: "dense" }, (_, index) => index === 0);
  assert.equal(store.readByUid("b").content, "dense");
  store.push({ messageUid: "d", role: "tool" });
  assert.equal(
    store.updateLast({ content: "matched" }, (item) => item.role === "assistant").messageUid,
    "c",
  );
  store.evictCommittedByUids(["b", "c", "d"]);
  assert.equal(store.updateLast({ content: "empty" }), null);
  assert.equal(
    store.updateLast({}, () => true),
    null,
  );
  assert.deepEqual(store.toArray(), []);
  store.push({ messageUid: "a", role: "assistant" });
  assert.equal(store.readFinalAssistant().messageUid, "a");
  store.replaceAll([{ messageUid: "replacement", summarized: true }]);
  assert.deepEqual(store.readSnapshot(), [{ messageUid: "replacement", summarized: true }]);
});

test("serialization failures reject every mutation atomically", () => {
  const cycle = {};
  cycle.self = cycle;
  for (const metadata of [
    cycle,
    1n,
    {
      toJSON() {
        throw new TypeError("serializer");
      },
    },
  ]) {
    assert.throws(
      () => createCurrentTurnMessagesStore([{ messageUid: "m1", metadata }]),
      TypeError,
    );
    const store = createCurrentTurnMessagesStore([{ messageUid: "m1" }, { messageUid: "m2" }]);
    const before = store.readPendingChanges();
    for (const mutate of [
      () => store.push({ messageUid: "m3", metadata }),
      () => store.updateByUid("m1", { metadata }),
      () => store.updateWhere({ metadata }),
      () => store.replaceAll([{ messageUid: "valid" }, { messageUid: "m3", metadata }]),
    ]) {
      assert.throws(mutate, TypeError);
      assert.deepEqual(store.toArray(), [{ messageUid: "m1" }, { messageUid: "m2" }]);
      assert.deepEqual(store.readPendingChanges(), before);
      assert.deepEqual(store.readCounts(), { messageCount: 2, assistantCount: 0, toolCount: 0 });
    }
  }
});

test("pending revisions remain isolated from sources, readers and stale acknowledgements", () => {
  const metadata = { values: ["first"] };
  const store = createCurrentTurnMessagesStore();
  const pushed = store.push({ messageUid: "m1", metadata });
  const first = store.readPendingChanges().entries;
  metadata.values.push("external");
  pushed.role = "tool";
  assert.throws(() => first[0].message.metadata.values.push("external"), TypeError);
  const patched = { values: ["second"] };
  store.updateByUid("m1", { metadata: patched });
  patched.values.push("external");
  store.acknowledgeChanges(first);
  const second = store.readPendingChanges().entries;
  assert.equal(second.length, 1);
  assert.ok(second[0].revision > first[0].revision);
  assert.deepEqual(first[0].message.metadata.values, ["first"]);
  assert.deepEqual(second[0].message.metadata.values, ["second"]);
  assert.equal(store.readByUid("m1").role, undefined);
  assert.throws(
    () =>
      store.updateLast({}, (message) => {
        message.role = "tool";
        return true;
      }),
    TypeError,
  );
  store.acknowledgeChanges(second);
  assert.deepEqual(store.readPendingChanges().entries, []);
});

test("summary revision selection survives acknowledgement and excludes edits and reintroduced UIDs", () => {
  const store = createCurrentTurnMessagesStore([
    { messageUid: "stable", content: "before" },
    { messageUid: "edited", content: "before" },
    { messageUid: "reintroduced", content: "before" },
  ]);
  const selection = store.readMessageRevisions([
    "stable",
    "edited",
    "reintroduced",
    "historical",
    "stable",
  ]);
  store.acknowledgeChanges(store.readPendingChanges().entries);
  assert.deepEqual(store.readUnchangedMessageUids(selection), [
    "stable",
    "edited",
    "reintroduced",
    "historical",
  ]);
  store.updateByUid("edited", { content: "during" });
  store.updateByUid("edited", { content: "before" });
  store.evictCommittedByUids(["reintroduced"]);
  store.push({ messageUid: "reintroduced", content: "before" });
  store.push({ messageUid: "historical", content: "restored" });
  store.toArray = store.readSnapshot = () => assert.fail("revision lookup must remain scoped");
  assert.deepEqual(store.readUnchangedMessageUids(selection), ["stable"]);
  assert.equal(store.readPendingChanges().entries.length, 3);
});

test("scoped operations bound internal Map access after a large committed prefix", (t) => {
  const store = createCurrentTurnMessagesStore(
    Array.from({ length: 4096 }, (_, index) => ({ messageUid: `prefix-${index}`, role: "tool" })),
  );
  store.push({ messageUid: "selected", role: "assistant", modelMessageId: "model" });
  store.acknowledgeChanges(store.readPendingChanges().entries);
  let accesses = 0;
  function visit(value) {
    accesses += 1;
    assert.ok(accesses < 64, "scoped operation traversed internal collections");
    assert.ok(!value?.messageUid?.startsWith("prefix-"), "committed prefix record was read");
    return value;
  }
  const get = Map.prototype.get;
  t.mock.method(Map.prototype, "get", function (key) {
    return visit(get.call(this, key));
  });
  for (const method of ["values", "entries", "keys", Symbol.iterator]) {
    const iterate = Map.prototype[method];
    t.mock.method(Map.prototype, method, function* () {
      for (const value of iterate.call(this)) {
        visit(Array.isArray(value) ? value[1] : value);
        yield value;
      }
    });
  }
  const forEach = Map.prototype.forEach;
  t.mock.method(Map.prototype, "forEach", function (callback, receiver) {
    return forEach.call(this, (value, key) => callback.call(receiver, visit(value), key, this));
  });
  try {
    const check = (action) => {
      accesses = 0;
      action();
    };
    check(() => store.updateByUid("selected", { content: "updated" }));
    check(() => store.updateLast({ content: "tail" }));
    check(() => store.readByUid("selected"));
    check(() => store.readMessagesByModelMessageId("model"));
    check(() => store.readAssistantByModelMessageId("model"));
    check(() => store.readArtifactProjectionSources());
    check(() => store.readPendingChanges());
    check(() => store.evictCommittedByUids(["selected"]));
  } finally {
    t.mock.restoreAll();
  }
  assert.equal(store.readCounts().messageCount, 4096);
});

test("serialized identity collisions reject admission without corrupting indexes or pending changes", () => {
  const collision = () => {
    const second = { messageUid: "second" };
    return [
      {
        messageUid: "first",
        metadata: {
          toJSON() {
            second.messageUid = "first";
            return {};
          },
        },
      },
      second,
    ];
  };
  assert.throws(() => createCurrentTurnMessagesStore(collision()), {
    code: "AGENT_TURN_RESULT_INVALID",
  });
  const store = createCurrentTurnMessagesStore([{ messageUid: "existing", role: "user" }]);
  const before = store.readPendingChanges();
  assert.throws(() => store.replaceAll(collision()), { code: "AGENT_TURN_RESULT_INVALID" });
  let calls = 0;
  assert.throws(
    () =>
      store.push({
        get messageUid() {
          return ++calls <= 2 ? "fresh" : "existing";
        },
        role: "assistant",
      }),
    { code: "AGENT_TURN_RESULT_INVALID" },
  );
  assert.deepEqual(store.toArray(), [{ messageUid: "existing", role: "user" }]);
  assert.deepEqual(store.readPendingChanges(), before);
  assert.deepEqual(store.readCounts(), { messageCount: 1, assistantCount: 0, toolCount: 0 });
  store.updateByUid("existing", { content: "still indexed" });
  assert.equal(store.readByUid("existing").content, "still indexed");
});
