/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { LENGTH_THRESHOLDS } from "@noobot/shared/length-thresholds";
import { PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE, requirePluginMessagePayload } from "../src/index.js";

function assertCode(value, code) {
  assert.throws(
    () => requirePluginMessagePayload(value),
    (error) => error instanceof TypeError && error.code === code,
  );
}

test("plugin message payload accepts plain JSON and returns it unchanged", () => {
  const payload = { runId: "r1", items: [{ id: "a", done: true, score: 1.5 }], note: null };
  assert.equal(requirePluginMessagePayload(payload), payload);
});

test("plugin message payload rejects non-JSON shapes", () => {
  for (const value of [
    null,
    undefined,
    [],
    "text",
    { count: Number.NaN },
    { count: Number.POSITIVE_INFINITY },
    { at: new Date(0) },
    { run: () => {} },
    { nested: [{ value: undefined }] },
    { big: 1n },
  ]) {
    assertCode(value, PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.INVALID);
  }
});

test("plugin message payload rejects transfer envelopes at any depth", () => {
  for (const value of [
    { transferEnvelopes: [] },
    { nodes: [{ nodeResultTransferEnvelopes: [] }] },
    { a: { b: { transferEnvelopes: [] } } },
  ]) {
    assertCode(value, PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.INVALID);
  }
});

test("plugin message payload rejects payloads above the byte limit", () => {
  const limit = LENGTH_THRESHOLDS.pluginMessage.payloadBytes;
  const atLimit = { text: "x".repeat(limit - JSON.stringify({ text: "" }).length) };
  assert.equal(requirePluginMessagePayload(atLimit), atLimit);
  assertCode({ text: `${atLimit.text}x` }, PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.TOO_LARGE);
  assertCode(
    { text: "中".repeat(Math.ceil(limit / 3) + 1) },
    PLUGIN_MESSAGE_PAYLOAD_ERROR_CODE.TOO_LARGE,
  );
});
