/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  executionLogByteBudget,
  encodeExecutionSegmentRecord,
  prepareExecutionLogRecord,
} from "@noobot/session-protocol";
import { createExecutionEventListener } from "../../src/events/execution-listener.js";

const { batchBytes: EXECUTION_LOG_BATCH_MAX_BYTES, pendingBytes: EXECUTION_LOG_MAX_PENDING_BYTES } =
  executionLogByteBudget();
const route = {
  userId: "u1",
  sessionId: "s1",
  parentSessionId: "",
  dialogProcessId: "d1",
  turnScopeId: "t1",
};
const timestamp = "2026-11-15T00:00:00.000Z";
const createListener = (appendExecutionLogs) =>
  createExecutionEventListener({
    ...route,
    persistenceScope: null,
    now: () => timestamp,
    sessionManager: { appendExecutionLogs },
  });
const emit = (listener, data) => listener.onEvent({ event: "byte_test", data });

test("protocol counts exact UTF-8 JSONL bytes and rejects an oversized record before admission", () => {
  const data = { nested: { text: "汉字😀\n" } };
  const record = { dialogProcessId: "d1", data };
  const prepared = prepareExecutionLogRecord(record);
  assert.equal(prepared.bytes, Buffer.byteLength(`${JSON.stringify(record)}\n`));
  data.nested.text = "changed";
  assert.equal(prepared.record.data.nested.text, "汉字😀\n");
  const envelope = { dialogProcessId: "d1", data: "" };
  const envelopeBytes = encodeExecutionSegmentRecord(envelope).bytes;
  const limitRecord = {
    ...envelope,
    data: "x".repeat(EXECUTION_LOG_BATCH_MAX_BYTES - envelopeBytes),
  };
  assert.equal(prepareExecutionLogRecord(limitRecord).bytes, EXECUTION_LOG_BATCH_MAX_BYTES);
  assert.throws(() => prepareExecutionLogRecord({ ...limitRecord, data: `${limitRecord.data}x` }), {
    code: "EXECUTION_LOG_RECORD_TOO_LARGE",
  });
});

test("listener splits by encoded bytes and persists the admitted snapshot in order", async () => {
  const batches = [];
  const listener = createListener(async ({ records }) => batches.push(records));
  const text = "汉".repeat(Math.floor(EXECUTION_LOG_BATCH_MAX_BYTES / 9));
  const data = { sequence: 0, nested: { text } };
  emit(listener, data);
  data.nested.text = "changed after admission";
  for (let sequence = 1; sequence < 7; sequence += 1)
    emit(listener, { sequence, nested: { text } });
  await listener.flush();
  assert.equal(batches.length, 4);
  assert.deepEqual(
    batches.flat().map(({ data }) => data.sequence),
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.equal(batches[0][0].data.nested.text, text);
  for (const records of batches) {
    const bytes = records.reduce(
      (total, record) => total + encodeExecutionSegmentRecord(record).bytes,
      0,
    );
    assert.ok(bytes <= EXECUTION_LOG_BATCH_MAX_BYTES);
  }
});

for (const fails of [false, true]) {
  test(`pending byte budget includes active writes and releases after ${fails ? "failure" : "success"}`, async () => {
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    const persisted = [];
    const writeFailure = new Error("disk unavailable");
    let first = true;
    const listener = createListener(async ({ records }) => {
      if (first) {
        first = false;
        started.resolve();
        await release.promise;
        if (fails) throw writeFailure;
      }
      persisted.push(...records);
    });
    const text = "x".repeat(EXECUTION_LOG_BATCH_MAX_BYTES - 2048);
    emit(listener, { sequence: 0, text });
    await started.promise;
    const capacity = Math.floor(EXECUTION_LOG_MAX_PENDING_BYTES / EXECUTION_LOG_BATCH_MAX_BYTES);
    for (let sequence = 1; sequence < capacity; sequence += 1) emit(listener, { sequence, text });
    assert.throws(() => emit(listener, { sequence: "rejected", text }), {
      code: "EXECUTION_LOG_BACKPRESSURE_REQUIRED",
    });
    release.resolve();
    if (fails) {
      await assert.rejects(listener.flush(), (error) => {
        assert.equal(error.code, "EXECUTION_LOG_PERSISTENCE_FAILED");
        assert.equal(error.cause, writeFailure);
        return true;
      });
    } else {
      await listener.flush();
    }
    await emit(listener, { sequence: "after-drain", text });
    if (fails) {
      await assert.rejects(listener.flush(), { code: "EXECUTION_LOG_PERSISTENCE_FAILED" });
    } else {
      await listener.flush();
    }
    assert.equal(persisted.at(-1).data.sequence, "after-drain");
    assert.equal(persisted.length, capacity + (fails ? 0 : 1));
  });
}

test("oversized and unserializable input rejects without occupying the queue", async () => {
  const persisted = [];
  const listener = createListener(async ({ records }) => persisted.push(...records));
  assert.throws(() => emit(listener, { text: "x".repeat(EXECUTION_LOG_BATCH_MAX_BYTES) }), {
    code: "EXECUTION_LOG_RECORD_TOO_LARGE",
  });
  const circular = {};
  circular.self = circular;
  assert.throws(() => emit(listener, circular), TypeError);
  await emit(listener, { text: "accepted" });
  await listener.flush();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].data.text, "accepted");
});
