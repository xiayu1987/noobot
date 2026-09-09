/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NODE_RESULT_FIRST_FIELDS,
  TRANSFER_ENVELOPE_FIELD,
  TRANSFER_ENVELOPE_FIELDS,
  TRANSFER_FIRST_FIELDS,
  collectAllTransferEnvelopeLists,
  collectTransferEnvelopeLists,
  isTransferEnvelopeField,
  pickTransferEnvelopeList,
} from "../src/index.js";

test("exposes the two canonical envelope field names", () => {
  assert.deepEqual(TRANSFER_ENVELOPE_FIELDS, ["transferEnvelopes", "nodeResultTransferEnvelopes"]);
  assert.deepEqual(NODE_RESULT_FIRST_FIELDS, [
    TRANSFER_ENVELOPE_FIELD.NODE_RESULT,
    TRANSFER_ENVELOPE_FIELD.TRANSFER,
  ]);
  assert.deepEqual(TRANSFER_FIRST_FIELDS, [
    TRANSFER_ENVELOPE_FIELD.TRANSFER,
    TRANSFER_ENVELOPE_FIELD.NODE_RESULT,
  ]);
});

test("isTransferEnvelopeField only accepts protocol field names", () => {
  assert.equal(isTransferEnvelopeField("transferEnvelopes"), true);
  assert.equal(isTransferEnvelopeField("nodeResultTransferEnvelopes"), true);
  assert.equal(isTransferEnvelopeField("attachments"), false);
  assert.equal(isTransferEnvelopeField(), false);
});

test("pickTransferEnvelopeList honours the field priority order", () => {
  const item = { transferEnvelopes: ["a"], nodeResultTransferEnvelopes: ["b"] };
  assert.deepEqual(pickTransferEnvelopeList(item, NODE_RESULT_FIRST_FIELDS), ["b"]);
  assert.deepEqual(pickTransferEnvelopeList(item, TRANSFER_FIRST_FIELDS), ["a"]);
});

test("skipEmpty=true treats an empty array as missing and falls through", () => {
  const item = { nodeResultTransferEnvelopes: [], transferEnvelopes: ["a"] };
  assert.deepEqual(pickTransferEnvelopeList(item, NODE_RESULT_FIRST_FIELDS), ["a"]);
});

test("skipEmpty=false keeps the legacy `a || b` semantics", () => {
  const item = { nodeResultTransferEnvelopes: [], transferEnvelopes: ["a"] };
  assert.deepEqual(
    pickTransferEnvelopeList(item, NODE_RESULT_FIRST_FIELDS, { skipEmpty: false }),
    [],
  );
});

test("pickTransferEnvelopeList accepts a single field without introducing a fallback", () => {
  const item = { transferEnvelopes: ["a"] };
  assert.deepEqual(pickTransferEnvelopeList(item, TRANSFER_ENVELOPE_FIELD.NODE_RESULT), []);
});

test("pickTransferEnvelopeList rejects non-record and non-array inputs", () => {
  assert.deepEqual(pickTransferEnvelopeList(null), []);
  assert.deepEqual(pickTransferEnvelopeList("x"), []);
  assert.deepEqual(pickTransferEnvelopeList([{ transferEnvelopes: ["a"] }]), []);
  assert.deepEqual(pickTransferEnvelopeList({ transferEnvelopes: "a" }), []);
});

test("collectTransferEnvelopeLists flattens one pick per source", () => {
  const sources = [
    { nodeResultTransferEnvelopes: ["a"], transferEnvelopes: ["ignored"] },
    { transferEnvelopes: ["b"] },
    null,
  ];
  assert.deepEqual(collectTransferEnvelopeLists(sources), ["a", "b"]);
  assert.deepEqual(collectTransferEnvelopeLists(sources, TRANSFER_ENVELOPE_FIELD.NODE_RESULT), [
    "a",
  ]);
});

test("collectAllTransferEnvelopeLists takes every field without priority", () => {
  const sources = [
    { nodeResultTransferEnvelopes: ["a"], transferEnvelopes: ["b"] },
    { transferEnvelopes: [] },
    undefined,
  ];
  assert.deepEqual(collectAllTransferEnvelopeLists(sources), ["b", "a"]);
});

test("collectAllTransferEnvelopeLists accepts a single source object", () => {
  assert.deepEqual(collectAllTransferEnvelopeLists({ transferEnvelopes: ["a"] }), ["a"]);
});
