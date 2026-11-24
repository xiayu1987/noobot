/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SESSION_ERROR_CODE } from "@noobot/session-protocol";
import { createCurrentTurnMessagesStore } from "../../../src/runtime/turn/current-turn-ledger.js";
import { bindCurrentTurnPersistence } from "../../../src/bot/execution/runner/current-turn-persistence.js";
import { createMessagePersistenceReceipt } from "@noobot/session-protocol/session-changes";

function bind(appendAgentMessages, commitSummaryCheckpoint) {
  const runtime = {
    currentTurnMessages: createCurrentTurnMessagesStore([
      { messageUid: "m1", role: "assistant", content: "initial" },
    ]),
  };
  bindCurrentTurnPersistence({
    dispatchRuntime: runtime,
    appendAgentMessages: async (input) =>
      (await appendAgentMessages(input)).map((message) =>
        createMessagePersistenceReceipt(
          { ...message, sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" },
          1,
          `test-content-${message.messageUid}-1`,
          1,
        ),
      ),
    sessionId: "s1",
    dialogProcessId: "d1",
    turnScopeId: "t1",
    commitSummaryCheckpoint,
  });
  return runtime;
}

test("summary and message checkpoints share commit order and capture changes when dequeued", async () => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const calls = [];
  const runtime = bind(
    async ({ messages }) => {
      calls.push(["append", messages.map(({ content }) => content)]);
      if (calls.length === 1) {
        entered.resolve();
        await release.promise;
      }
      return messages;
    },
    async ({ runtime }) => {
      const { entries } = runtime.currentTurnMessages.readPendingChanges();
      calls.push(["summary", entries.map(({ message }) => message.content)]);
      runtime.currentTurnMessages.acknowledgeChanges(entries);
      runtime.currentTurnMessages.push({
        messageUid: "m2",
        role: "tool",
        content: "after summary",
      });
      return { committed: true };
    },
  );
  const first = runtime.persistCurrentTurnMessages();
  await entered.promise;
  runtime.currentTurnMessages.updateByUid("m1", { content: "before summary" });
  const summary = runtime.commitSummaryCheckpoint();
  const last = runtime.persistCurrentTurnMessages();
  await Promise.resolve();
  assert.equal(calls.length, 1, "summary must wait for the in-flight append");
  release.resolve();
  await Promise.all([first, summary, last]);
  assert.deepEqual(calls, [
    ["append", ["initial"]],
    ["summary", ["before summary"]],
    ["append", ["after summary"]],
  ]);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
});

test("a failed summary preserves its pending changes and the shared queue accepts a retry", async () => {
  let attempts = 0;
  const runtime = bind(
    async ({ messages }) => messages,
    async ({ runtime }) => {
      attempts += 1;
      if (attempts === 1) throw new Error("summary write failed");
      const { entries } = runtime.currentTurnMessages.readPendingChanges();
      assert.equal(entries[0].message.content, "initial");
      runtime.currentTurnMessages.acknowledgeChanges(entries);
      return { committed: true };
    },
  );
  await assert.rejects(runtime.commitSummaryCheckpoint(), /summary write failed/);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 1);
  await runtime.commitSummaryCheckpoint();
  assert.equal(attempts, 2);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
});

test("an in-flight checkpoint owns its snapshot and a later checkpoint persists concurrent changes", async () => {
  let entered;
  let release;
  const started = new Promise((resolve) => (entered = resolve));
  const blocked = new Promise((resolve) => (release = resolve));
  const batches = [];
  const runtime = bind(async ({ messages }) => {
    batches.push(messages);
    entered();
    if (batches.length === 1) await blocked;
    return messages;
  });
  const first = runtime.persistCurrentTurnMessages();
  await started;
  runtime.currentTurnMessages.updateLast({ content: "updated" });
  runtime.currentTurnMessages.push({ messageUid: "m2", role: "tool", content: "result" });
  const second = runtime.persistCurrentTurnMessages();
  assert.equal(batches[0][0].content, "initial");
  release();
  await Promise.all([first, second]);
  assert.deepEqual(
    batches.map((batch) => batch.map(({ content }) => content)),
    [["initial"], ["updated", "result"]],
  );
  await runtime.persistCurrentTurnMessages();
  assert.equal(batches.length, 2);
});

test("nested updates cannot mutate an in-flight payload and remain pending for the next checkpoint", async () => {
  let entered;
  let release;
  const started = new Promise((resolve) => (entered = resolve));
  const blocked = new Promise((resolve) => (release = resolve));
  const batches = [];
  const runtime = bind(async ({ messages, changes }) => {
    batches.push(changes);
    if (batches.length === 1) {
      entered();
      await blocked;
    }
    return messages;
  });
  const modelResponseMetadata = { text: "first", nested: { count: 1 } };
  runtime.currentTurnMessages.updateByUid("m1", { modelResponseMetadata });
  const first = runtime.persistCurrentTurnMessages();
  await started;
  modelResponseMetadata.text = "second";
  modelResponseMetadata.nested.count = 2;
  runtime.currentTurnMessages.updateByUid("m1", { modelResponseMetadata });
  const second = runtime.persistCurrentTurnMessages();
  assert.deepEqual(batches[0].messages[0].modelResponseMetadata, {
    text: "first",
    nested: { count: 1 },
  });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(batches[1].messageMetadataUpdates[0].metadata.modelResponseMetadata, {
    text: "second",
    nested: { count: 2 },
  });
  await runtime.persistCurrentTurnMessages();
  assert.equal(batches.length, 2);
});

test("checkpoint snapshots preserve JSON value semantics and serialize custom values once", async () => {
  let serializations = 0;
  const runtime = bind(async ({ messages }) => {
    assert.deepEqual(messages[0].detail, {
      date: "2026-01-01T00:00:00.000Z",
      map: {},
      custom: { value: 7 },
    });
    return messages;
  });
  runtime.currentTurnMessages.updateByUid("m1", {
    detail: {
      date: new Date("2026-01-01T00:00:00.000Z"),
      map: new Map([["key", 1]]),
      custom: {
        toJSON() {
          serializations += 1;
          return { value: 7 };
        },
      },
      omitted: undefined,
    },
  });
  await runtime.persistCurrentTurnMessages();
  assert.equal(serializations, 1);
});

test("committed message prefixes are neither read nor serialized by later checkpoints", async () => {
  let rejectPrefixReads = false;
  let prefixSerializations = 0;
  const batches = [];
  const runtime = bind(async ({ messages }) => {
    batches.push(messages.map(({ messageUid }) => messageUid));
    return messages;
  });
  runtime.currentTurnMessages.updateByUid("m1", {
    activityTimeline: [
      {
        eventId: "initial",
        toJSON() {
          prefixSerializations += 1;
          assert.equal(rejectPrefixReads, false, "committed prefix was serialized");
          return { eventId: "initial" };
        },
      },
    ],
  });
  await runtime.persistCurrentTurnMessages();
  const initialSerializations = prefixSerializations;
  rejectPrefixReads = true;
  runtime.currentTurnMessages.readSnapshot = () => assert.fail("full snapshot was read");
  runtime.currentTurnMessages.toArray = () => assert.fail("all messages were read");
  for (let index = 0; index < 100; index += 1) {
    runtime.currentTurnMessages.push({
      messageUid: `tool-${index}`,
      role: "tool",
      content: "result",
    });
    await runtime.persistCurrentTurnMessages();
  }
  await runtime.persistCurrentTurnMessages();
  assert.equal(prefixSerializations, initialSerializations);
  assert.equal(batches.length, 101);
  assert.ok(batches.every((batch) => batch.length === 1));
});

test("failed verification does not acknowledge a changed snapshot and retries it", async () => {
  const batches = [];
  const runtime = bind(async ({ messages }) => {
    batches.push(messages);
    if (batches.length === 1) throw new Error("write failed");
    if (batches.length === 2) return [];
    return messages;
  });
  await assert.rejects(runtime.persistCurrentTurnMessages(), /write failed/);
  await assert.rejects(runtime.persistCurrentTurnMessages(), {
    code: SESSION_ERROR_CODE.TURN_MESSAGE_NOT_PERSISTED,
  });
  await runtime.persistCurrentTurnMessages();
  assert.equal(batches.length, 3);
  assert.deepEqual(batches[0][0], batches[2][0]);
});

test("same-value replacement avoids a write; removal and reintroduction preserve checkpoint selection", async () => {
  const batches = [];
  const runtime = bind(async ({ messages }) => {
    batches.push(messages);
    return messages;
  });
  await runtime.persistCurrentTurnMessages();
  runtime.currentTurnMessages.replaceAll(runtime.currentTurnMessages.toArray());
  await runtime.persistCurrentTurnMessages();
  assert.equal(batches.length, 1);
  runtime.currentTurnMessages.replaceAll([{ messageUid: "m2", role: "tool", content: "two" }]);
  await runtime.persistCurrentTurnMessages();
  runtime.currentTurnMessages.replaceAll([
    { messageUid: "m1", role: "assistant", content: "initial" },
  ]);
  await runtime.persistCurrentTurnMessages();
  assert.deepEqual(
    batches.map((batch) => batch.map(({ messageUid }) => messageUid)),
    [["m1"], ["m2"], ["m1"]],
  );
});

test("batch operation and checkpoint failures both survive, and uncommitted changes retry", async () => {
  const operationFailure = new Error("tool result processing failed");
  const persistenceFailure = new Error("checkpoint write failed");
  let attempts = 0;
  const runtime = bind(async ({ messages }) => {
    if (++attempts === 1) throw persistenceFailure;
    return messages;
  });
  await assert.rejects(
    runtime.withCurrentTurnPersistenceBatch(async () => {
      await runtime.persistCurrentTurnMessages();
      throw operationFailure;
    }),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [operationFailure, persistenceFailure]);
      assert.equal(error.cause, operationFailure);
      return true;
    },
  );
  assert.equal(attempts, 1);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 1);
  await runtime.persistCurrentTurnMessages();
  assert.equal(attempts, 2);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
});

test("batch failures preserve single error identity while still flushing requested changes", async () => {
  const failure = new Error("operation failed");
  let attempts = 0;
  const runtime = bind(async ({ messages }) => {
    attempts += 1;
    return messages;
  });
  await assert.rejects(
    runtime.withCurrentTurnPersistenceBatch(async () => {
      await runtime.persistCurrentTurnMessages();
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.equal(attempts, 1);
  assert.equal(runtime.currentTurnMessages.readPendingChanges().entries.length, 0);
});

test("nested batches flush once at the outer boundary and preserve the operation result", async () => {
  let attempts = 0;
  const runtime = bind(async ({ messages }) => {
    attempts += 1;
    return messages;
  });
  const result = await runtime.withCurrentTurnPersistenceBatch(async () => {
    await runtime.persistCurrentTurnMessages();
    const nested = await runtime.withCurrentTurnPersistenceBatch(async () => {
      await runtime.persistCurrentTurnMessages();
      return "inner";
    });
    assert.equal(nested, "inner");
    assert.equal(attempts, 0);
    return "outer";
  });
  assert.equal(result, "outer");
  assert.equal(attempts, 1);
});
