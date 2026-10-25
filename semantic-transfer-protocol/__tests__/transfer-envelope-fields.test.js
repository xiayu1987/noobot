/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSFER_ENVELOPE_FIELD,
  TRANSFER_ENVELOPE_FIELDS,
  collectAllTransferEnvelopeLists,
  isTransferEnvelopeField,
  readTransferEnvelopeList,
} from "../src/index.js";
import * as protocol from "../src/index.js";

test("exposes the two canonical envelope field names", () => {
  assert.deepEqual(TRANSFER_ENVELOPE_FIELDS, ["transferEnvelopes", "nodeResultTransferEnvelopes"]);
});

test("does not expose field priority lists or fallback pickers", () => {
  for (const name of [
    "NODE_RESULT_FIRST_FIELDS",
    "TRANSFER_FIRST_FIELDS",
    "pickTransferEnvelopeList",
    "collectTransferEnvelopeLists",
  ]) {
    assert.equal(name in protocol, false, name);
  }
});

test("isTransferEnvelopeField only accepts protocol field names", () => {
  assert.equal(isTransferEnvelopeField("transferEnvelopes"), true);
  assert.equal(isTransferEnvelopeField("nodeResultTransferEnvelopes"), true);
  assert.equal(isTransferEnvelopeField("attachments"), false);
  assert.equal(isTransferEnvelopeField(undefined), false);
});

test("readTransferEnvelopeList reads only the declared carrier field", () => {
  const item = { transferEnvelopes: ["a"], nodeResultTransferEnvelopes: ["b"] };
  assert.deepEqual(readTransferEnvelopeList(item, TRANSFER_ENVELOPE_FIELD.NODE_RESULT), ["b"]);
  assert.deepEqual(readTransferEnvelopeList(item, TRANSFER_ENVELOPE_FIELD.TRANSFER), ["a"]);
});

test("readTransferEnvelopeList does not fall back to another field when empty", () => {
  const item = { nodeResultTransferEnvelopes: [], transferEnvelopes: ["a"] };
  assert.deepEqual(readTransferEnvelopeList(item, TRANSFER_ENVELOPE_FIELD.NODE_RESULT), []);
});

test("readTransferEnvelopeList rejects missing or malformed carriers", () => {
  const field = TRANSFER_ENVELOPE_FIELD.NODE_RESULT;
  assert.throws(
    () => readTransferEnvelopeList({ transferEnvelopes: ["a"] }, field),
    /transfer_envelope_list_invalid:nodeResultTransferEnvelopes/,
  );
  assert.throws(
    () => readTransferEnvelopeList({ nodeResultTransferEnvelopes: "a" }, field),
    /transfer_envelope_list_invalid/,
  );
  assert.throws(() => readTransferEnvelopeList(null, field), /transfer_envelope_carrier_invalid/);
  assert.throws(() => readTransferEnvelopeList([], field), /transfer_envelope_carrier_invalid/);
  assert.throws(
    () => readTransferEnvelopeList({ attachments: [] }, "attachments"),
    /transfer_envelope_field_invalid:attachments/,
  );
});

test("collectAllTransferEnvelopeLists takes every field without priority", () => {
  const sources = [
    { nodeResultTransferEnvelopes: ["a"], transferEnvelopes: ["b"] },
    { transferEnvelopes: [] },
    undefined,
  ];
  assert.deepEqual(collectAllTransferEnvelopeLists(sources), ["b", "a"]);
});
