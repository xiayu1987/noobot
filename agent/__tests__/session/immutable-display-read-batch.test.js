/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { ImmutableSessionStore } from "../../src/session/session-artifact-session/immutable-session-store.js";
import { ImmutableObjectStore } from "../../src/session/session-artifact-session/immutable-object-store.js";
import { readImmutableSessionMessages } from "../../src/session/session-artifact-session/immutable-message-reader.js";
import { ImmutableValueStore } from "../../src/session/session-artifact-session/immutable-value-store.js";
import { QUANTITY_THRESHOLDS } from "@noobot/shared/quantity-thresholds";
import { immutableOrderKey } from "../../src/session/session-artifact-session/immutable-order-key.js";
import { IMMUTABLE_VALUE_READ_BATCH_RECORDS } from "@noobot/session-protocol/immutable-storage-graph";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

function fixture(count) {
  const records = Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    const uid = `m${ordinal}`;
    return [
      uid,
      {
        ordinal,
        message: {
          messageUid: uid,
          userMessageId: `u${ordinal}`,
          sessionId: "s1",
          parentSessionId: "",
          dialogProcessId: "d1",
          parentDialogProcessId: "",
          turnScopeId: "t1",
          role: "user",
          messageOrigin: "natural",
          type: "message",
          content: `text ${ordinal}`,
          attachments: [],
          ts: "2026-01-01T00:00:00.000Z",
        },
      },
    ];
  });
  const collections = {
    messages: records.slice().reverse(),
    messageOrder: records.map(([uid, record]) => [immutableOrderKey(record.ordinal), uid]),
  };
  const snapshot = {};
  const store = {
    sessionId: "s1",
    objects: { materializeValues: async (records) => records.map(({ value }) => value) },
    async *entries(head, collection, options) {
      assert.strictEqual(head, snapshot);
      for (const [key, value] of collections[collection])
        yield [key, options?.metadata ? { value, parts: [] } : value];
    },
  };
  return { store, snapshot, collections, facts: { messageCount: count, messageSequence: count } };
}

test("full message traversal restores order across batches without message point lookups", async () => {
  const { store, snapshot, facts } = fixture(IMMUTABLE_VALUE_READ_BATCH_RECORDS + 3);
  const batches = [];
  store.objects.materializeValues = async (records) => {
    batches.push(records.length);
    return records.map(({ value }) => value);
  };
  const messages = await readImmutableSessionMessages({ store, snapshot, facts, turns: {} });
  assert.deepEqual(batches, [IMMUTABLE_VALUE_READ_BATCH_RECORDS, 3]);
  assert.deepEqual(
    messages.map((message) => message.content),
    Array.from({ length: facts.messageCount }, (_, index) => `text ${index + 1}`),
  );
});

for (const corruption of [
  "missing order",
  "missing message",
  "wrong identity",
  "duplicate ordinal",
  "invalid entity",
]) {
  test(`full message traversal rejects ${corruption}`, async () => {
    const { store, snapshot, facts, collections } = fixture(3);
    if (corruption === "missing order") collections.messageOrder.pop();
    if (corruption === "missing message") collections.messages.pop();
    if (corruption === "wrong identity") collections.messages[0][1].message.messageUid = "other";
    if (corruption === "duplicate ordinal") collections.messages[0][1].ordinal = 2;
    if (corruption === "invalid entity") collections.messages[0][1].message.content = null;
    await assert.rejects(readImmutableSessionMessages({ store, snapshot, facts, turns: {} }), {
      code: "SESSION_IMMUTABLE_STORAGE_INVALID",
    });
  });
}

for (const fail of [false, true]) {
  test(`collection batch traversal releases its iterator after ${fail ? "read failure" : "early return"}`, async () => {
    let released = false;
    const failure = new Error("injected batch I/O failure");
    const snapshot = {};
    const store = {
      objects: {
        withSnapshot: async (head, operation) => {
          assert.strictEqual(head, snapshot);
          return operation();
        },
        readValues: async (references) => {
          assert.ok(references.length <= IMMUTABLE_VALUE_READ_BATCH_RECORDS);
          if (fail) throw failure;
          return references;
        },
      },
      index: {
        get: async () => "root",
        async *entries() {
          try {
            for (let index = 0; index < IMMUTABLE_VALUE_READ_BATCH_RECORDS + 2; index++)
              yield [`key${index}`, `value${index}`];
          } finally {
            released = true;
          }
        },
      },
    };
    const entries = ImmutableSessionStore.prototype.entries.call(store, snapshot, "messages");
    if (fail) await assert.rejects(entries.next(), (error) => error === failure);
    else {
      assert.deepEqual((await entries.next()).value, ["key0", "value0"]);
      await entries.return();
    }
    assert.equal(released, true);
  });
}

test("concurrent value decoding preserves duplicate input positions and content parts", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "display-batch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const objects = new ImmutableObjectStore(directory);
  const expected = Array.from({ length: IMMUTABLE_VALUE_READ_BATCH_RECORDS + 2 }, (_, index) => ({
    message: { content: `content ${index}` },
    index,
  }));
  const references = [];
  for (const value of expected)
    references.push(await objects.putValue(value, { contentPaths: [["message", "content"]] }));
  references.push(references[0]);
  expected.push(expected[0]);
  assert.deepEqual(await objects.readValues(references), expected);
});

for (const fail of [false, true]) {
  test(`value decoding ${fail ? "drains concurrent failures" : "preserves positions after reverse completion"}`, async () => {
    const concurrency = QUANTITY_THRESHOLDS.immutableStorage.recordIoConcurrency;
    assert.ok(concurrency > 1);
    const references = Array.from({ length: concurrency + 1 }, (_, index) => String(index));
    const gates = references.map(() => Promise.withResolvers());
    const started = [];
    let settled = false;
    const store = Object.assign(new ImmutableValueStore(), {
      readMany: async (selected) =>
        new Map(
          selected.map((reference) => {
            const bytes = Buffer.from(JSON.stringify(reference));
            return [
              reference,
              Buffer.from(
                JSON.stringify({
                  kind: "value-inline",
                  bytes: bytes.length,
                  data: bytes.toString("base64"),
                }),
              ),
            ];
          }),
        ),
      async materializeValue({ value: reference }) {
        started.push(reference);
        await gates[Number(reference)].promise;
        return reference;
      },
    });
    const pending = ImmutableValueStore.prototype.readDecodedValues.call(store, references, false);
    const observed = pending.then(
      (value) => {
        settled = true;
        return { value };
      },
      (error) => {
        settled = true;
        return { error };
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started.length, concurrency);
    if (fail) {
      const failures = [new Error("first decode failed"), new Error("second decode failed")];
      gates[0].reject(failures[0]);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false);
      assert.equal(started.length, concurrency);
      gates[1].reject(failures[1]);
      for (const gate of gates.slice(2, concurrency)) gate.resolve();
      const { error } = await observed;
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, failures);
      assert.equal(error.cause, failures[0]);
      assert.equal(started.length, concurrency);
    } else {
      for (const gate of gates.slice().reverse()) gate.resolve();
      assert.deepEqual((await observed).value, references);
    }
  });
}
