/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MESSAGE_ORIGIN,
  SESSION_MESSAGE_ENTITY_INVALID,
  assertSessionMessageEntity,
  collectSessionMessageEntityErrors,
  isDialogAnchorMessageRecord,
  isInternalDialogUserMessage,
} from "../src/index.js";

const base = { content: "hi", attachments: [], ts: "2026-01-01T00:00:00.000Z" };

test("dialog user messages require a canonical messageOrigin", () => {
  assert.deepEqual(
    collectSessionMessageEntityErrors({ ...base, role: "user", messageOrigin: "natural" }),
    [],
  );
  assert.deepEqual(collectSessionMessageEntityErrors({ ...base, role: "user" }), [
    "message_origin_required",
  ]);
  assert.deepEqual(
    collectSessionMessageEntityErrors({ ...base, role: "user", messageOrigin: "Natural" }),
    ["message_origin_required"],
  );
});

test("non-dialog messages must not carry messageOrigin", () => {
  for (const record of [
    { ...base, role: "assistant", messageOrigin: "natural" },
    { ...base, role: "user", injectedMessage: true, messageOrigin: "internal" },
    { ...base, role: "user", pluginMessage: true, messageOrigin: "natural" },
  ]) {
    assert.deepEqual(collectSessionMessageEntityErrors(record), ["message_origin_forbidden"]);
  }
  assert.deepEqual(collectSessionMessageEntityErrors({ ...base, role: "tool" }), []);
});

test("content is a string and attachments is always an array", () => {
  assert.throws(
    () => assertSessionMessageEntity({ role: "assistant", content: null }),
    (error) =>
      error.code === SESSION_MESSAGE_ENTITY_INVALID &&
      error.validationErrors.join() ===
        "content_not_string,attachments_not_array,ts_not_canonical_iso",
  );
});

test("ts must be a canonical ISO timestamp", () => {
  assert.deepEqual(collectSessionMessageEntityErrors({ ...base, role: "tool" }), []);
  for (const ts of [
    undefined,
    "",
    1767225600000,
    "2026-01-01T00:00:00Z",
    "2026-01-01T08:00:00+08:00",
  ]) {
    assert.deepEqual(collectSessionMessageEntityErrors({ ...base, role: "tool", ts }), [
      "ts_not_canonical_iso",
    ]);
  }
});

test("dialog anchor reads the explicit origin instead of inferring natural", () => {
  const natural = { ...base, role: "user", messageOrigin: MESSAGE_ORIGIN.NATURAL };
  const internal = { ...base, role: "user", messageOrigin: MESSAGE_ORIGIN.INTERNAL };
  assert.equal(isDialogAnchorMessageRecord(natural), true);
  assert.equal(isDialogAnchorMessageRecord(internal), false);
  assert.equal(isDialogAnchorMessageRecord({ ...base, role: "user" }), false);
  assert.equal(isInternalDialogUserMessage(internal), true);
});
