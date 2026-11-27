/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PARTITION_COLLECTION_FRAME,
  PARTITION_JOURNAL_FRAME,
  decodePartitionJournalFrameRequest,
  encodePartitionJournalFrameRequest,
  encodePartitionJournalRequest,
} from "../src/partition-journal.js";
import {
  PARTITION_TRANSACTION_FORMAT,
  capturePartitionTransactionRequest,
  preparePartitionSessionCommitRequest,
} from "../src/partition-transaction.js";
import { sessionRequestDigest } from "../src/session-request-digest.js";
import { restoreSessionCommitRequest } from "../src/session-changes.js";
import {
  encodeBoundedJournalJson,
  measureBoundedJournalJson,
} from "../src/partition-journal-json.js";

test("journal JSON encodes and measures the exact UTF-8 byte boundary", () => {
  const value = { ascii: [true, null, -12.5], é中: ["\u0080", "\u{1f600}", "\ud800", '\t\n\\"'] };
  const serialized = JSON.stringify(value);
  const bytes = new TextEncoder().encode(serialized).length;
  const maxDepth = PARTITION_JOURNAL_FRAME.maxJsonDepth;
  const exceeded = new Error("test byte budget exceeded");
  const budgetError = () => exceeded;
  assert.equal(measureBoundedJournalJson(value, bytes, maxDepth, budgetError), bytes);
  assert.equal(
    encodeBoundedJournalJson(value, { budget: bytes, maxDepth, budgetError }),
    serialized,
  );
  assert.throws(() => measureBoundedJournalJson(value, bytes - 1, maxDepth, budgetError), exceeded);
});

test("journal JSON rejects original errors and reports each containing field", () => {
  const value = { changes: { terminalStatus: { errors: [new Error("original")] } } };
  assert.throws(
    () => encodeBoundedJournalJson(value, { budget: Infinity, maxDepth: 20 }),
    (error) => {
      assert.equal(
        error.message,
        'Journal JSON requires plain objects or arrays at [0] at ["errors"] at ["terminalStatus"] at ["changes"]',
      );
      return true;
    },
  );
});

const limits = { transactionBytes: 4096 };
const overhead = PARTITION_JOURNAL_FRAME.headerBytes + PARTITION_JOURNAL_FRAME.trailer.length;

test("transaction admission reuses captured input without relaxing a destination byte limit", () => {
  const epoch = "a".repeat(32);
  const expectedGeneration = 2;
  const command = {
    operationId: "prepared-budget",
    changes: { messages: [{ content: '中😀\ud800\n"' }] },
    committedAt: "2026-11-22T00:00:00.000Z",
  };
  const input = { changes: command.changes, committedAt: command.committedAt };
  const exact = { transactionBytes: Buffer.byteLength(JSON.stringify(input)) + overhead };
  const tooSmall = { transactionBytes: exact.transactionBytes - 1 };
  const snapshot = { epoch, sequence: expectedGeneration, limits: exact };
  const prepared = preparePartitionSessionCommitRequest(snapshot, command);
  for (const request of [prepared, restoreSessionCommitRequest(JSON.stringify(prepared))]) {
    const admitted = capturePartitionTransactionRequest(request, exact);
    assert.strictEqual(admitted.request.input, request.input);
    assert.equal(admitted.identity.requestDigest, sessionRequestDigest(expectedGeneration, input));
    assert.throws(() => capturePartitionTransactionRequest(request, tooSmall), {
      code: "SESSION_TRANSACTION_BUDGET",
    });
  }
  assert.throws(
    () => preparePartitionSessionCommitRequest({ ...snapshot, limits: tooSmall }, command),
    { code: "SESSION_TRANSACTION_BUDGET" },
  );
});

function request() {
  const epoch = "a".repeat(32);
  return {
    epoch,
    sequence: 2,
    payload: {
      format: PARTITION_TRANSACTION_FORMAT,
      expectedGeneration: 1,
      operationId: "bounded-frame",
      requestDigest: "b".repeat(64),
      mutations: Array.from({ length: 10 }, (_, slot) => ({
        collection: "messages",
        key: `m${slot}`,
        owner: { epoch, partition: 0, sequence: 1, slot },
        value: "",
      })),
      result: null,
    },
  };
}

const encode = (value) => encodePartitionJournalFrameRequest(value, limits, "collections");

test("collection frames store the epoch and request digest as fixed-width bytes", () => {
  const input = request();
  const encoded = encode(input);
  const text = Buffer.from(encoded.body).toString("utf8");
  assert.ok(!text.includes(input.epoch));
  assert.ok(!text.includes(input.payload.requestDigest));
  assert.ok(!text.includes(input.payload.format));
  assert.deepEqual(decodePartitionJournalFrameRequest(encoded.body, "collections"), input);
});

test("collection frame admission rejects invalid formats, generations, digests and owner epochs", () => {
  const input = request();
  assert.throws(
    () => encode({ ...input, payload: { ...input.payload, format: "unknown" } }),
    /Unknown partition transaction format/,
  );
  assert.throws(() => encode({ ...input, payload: { ...input.payload, expectedGeneration: 0 } }), {
    code: "SESSION_GENERATION_CONFLICT",
  });
  assert.throws(
    () => encode({ ...input, payload: { ...input.payload, requestDigest: "B".repeat(64) } }),
    /Invalid transaction request digest/,
  );
  input.payload.mutations[0].owner.epoch = "c".repeat(32);
  assert.throws(() => encode(input), /another journal epoch/);
});

test("collection admission uses exact physical frame bytes including slots and UTF-8", () => {
  const input = request();
  const available = limits.transactionBytes - overhead - encode(input).body.length;
  input.payload.mutations[0].value = "x".repeat(available - 4) + "😀";
  assert.ok(Buffer.byteLength(JSON.stringify(input)) + overhead > limits.transactionBytes);
  const encoded = encode(input);
  assert.equal(encoded.body.length + overhead, limits.transactionBytes);
  assert.deepEqual(encoded.request, input);
  assert.deepEqual(decodePartitionJournalFrameRequest(encoded.body, "collections"), input);
  input.payload.mutations[0].value += "x";
  assert.throws(() => encode(input), { code: "SESSION_TRANSACTION_BUDGET" });
  assert.notDeepEqual(encoded.request, input);
});

test("collection slot overhead rejects a frame whose physical payload without its table fits", () => {
  const input = request();
  for (const mutation of input.payload.mutations) mutation.owner = null;
  const { slotBytes, countBytes } = PARTITION_COLLECTION_FRAME;
  const tableBytes = countBytes + input.payload.mutations.length * slotBytes;
  const payloadBytes = encode(input).body.length - tableBytes;
  input.payload.mutations[0].value = "x".repeat(limits.transactionBytes - overhead - payloadBytes);
  const measured = encodePartitionJournalFrameRequest(
    input,
    { transactionBytes: limits.transactionBytes + tableBytes },
    "collections",
  );
  assert.equal(measured.body.length + overhead, limits.transactionBytes + tableBytes);
  assert.throws(() => encode(input), { code: "SESSION_TRANSACTION_BUDGET" });
});

test("collection capture rejects oversized values and slot counts before later getters", () => {
  for (const largeCount of [false, true]) {
    const input = request();
    let visited = false;
    if (largeCount) input.payload.mutations.length = 1000000;
    else input.payload.mutations[0].value = "x".repeat(1000000);
    Object.defineProperty(input.payload.mutations, "1", {
      enumerable: true,
      get() {
        visited = true;
        throw new Error("must not execute");
      },
    });
    assert.throws(() => encode(input), { code: "SESSION_TRANSACTION_BUDGET" });
    assert.equal(visited, false);
  }
});

test("collection capture rejects accessors and discarded structural fields", () => {
  const selectors = [
    (input) => input,
    (input) => input.payload,
    (input) => input.payload.mutations,
    (input) => input.payload.mutations[0],
    (input) => input.payload.mutations[0].owner,
  ];
  for (const select of selectors) {
    for (const extra of ["symbol", "hidden", "getter"]) {
      const input = request();
      const target = select(input);
      let visited = false;
      if (extra === "symbol") target[Symbol("extra")] = "discarded";
      else if (extra === "hidden") Object.defineProperty(target, "extra", { value: "discarded" });
      else {
        const key = Object.keys(target)[0];
        Object.defineProperty(target, key, {
          enumerable: true,
          get() {
            visited = true;
            throw new Error("must not execute");
          },
        });
      }
      assert.throws(() => encode(input), TypeError);
      assert.equal(visited, false);
    }
  }
});

test("collection values retain the journal JSON depth and lossless data contract", () => {
  const input = request();
  let nested = null;
  for (let index = 0; index < PARTITION_JOURNAL_FRAME.maxJsonDepth - 4; index += 1)
    nested = { next: nested };
  input.payload.mutations[0].value = nested;
  assert.doesNotThrow(() => encodePartitionJournalRequest(input, limits));
  assert.deepEqual(encode(input).request, input);
  input.payload.mutations[0].value = { next: nested };
  assert.throws(() => encodePartitionJournalRequest(input, limits), /nesting/);
  assert.throws(() => encode(input), /nesting/);
  const cycle = {};
  cycle.self = cycle;
  const hidden = Object.defineProperty({}, "extra", { value: 1 });
  for (const value of [
    undefined,
    NaN,
    cycle,
    Array(2),
    hidden,
    {
      toJSON() {
        return null;
      },
    },
  ]) {
    input.payload.mutations[0].value = value;
    assert.throws(() => encode(input), TypeError);
  }
});
