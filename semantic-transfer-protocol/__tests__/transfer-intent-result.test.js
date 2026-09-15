/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TRANSFER_MIME_TYPE,
  TRANSFER_REASON,
  TRANSFER_REASON_ALIAS,
  TRANSFER_RESULT_STATUS,
  TRANSFER_SOURCE,
  createTransferResult,
  normalizeTransferReason,
  normalizeTransferSource,
  resolveTransferIntent,
} from "../src/index.js";

test("vocabulary exposes frozen reason table and default mime type", () => {
  assert.equal(DEFAULT_TRANSFER_MIME_TYPE, "text/plain");
  assert.equal(Object.isFrozen(TRANSFER_REASON), true);
  assert.equal(Object.isFrozen(TRANSFER_REASON_ALIAS), true);
});

test("normalizeTransferSource lowercases known sources, falls back on blanks and rejects unknown", () => {
  assert.equal(normalizeTransferSource(" TOOL "), TRANSFER_SOURCE.TOOL);
  assert.equal(normalizeTransferSource(""), TRANSFER_SOURCE.SERVICE);
  assert.throws(
    () => normalizeTransferSource("custom_source"),
    /unknown_transfer_source:custom_source/,
  );
});

test("normalizeTransferReason resolves aliases and rejects values outside the vocabulary", () => {
  for (const [alias, canonical] of Object.entries(TRANSFER_REASON_ALIAS)) {
    assert.equal(normalizeTransferReason(alias), canonical);
    assert.equal(Object.values(TRANSFER_REASON).includes(canonical), true);
  }
  assert.equal(normalizeTransferReason(""), TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT);
  assert.throws(() => normalizeTransferReason("free_form"), /unknown_transfer_reason:free_form/);
});

test("resolveTransferIntent resolves only the transfer semantic slots", () => {
  const intent = resolveTransferIntent({
    source: "TOOL",
    reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
  });
  assert.deepEqual(intent, {
    source: TRANSFER_SOURCE.TOOL,
    reason: TRANSFER_REASON.SEMANTIC_TRANSFER_TOOL_INPUT,
  });
});

test("resolveTransferIntent falls back to protocol defaults on blanks", () => {
  const allDefault = resolveTransferIntent();
  assert.equal(allDefault.source, TRANSFER_SOURCE.SERVICE);
  assert.equal(allDefault.reason, TRANSFER_REASON.SEMANTIC_TRANSFER_OUTPUT);
  assert.equal(Object.keys(allDefault).sort().join(","), "reason,source");
});

test("createTransferResult normalizes status and drops empty meta", () => {
  assert.deepEqual(createTransferResult(), {
    ok: true,
    status: TRANSFER_RESULT_STATUS.DIRECT,
  });
  assert.deepEqual(createTransferResult({ status: "  " }), {
    ok: true,
    status: TRANSFER_RESULT_STATUS.DIRECT,
  });
  assert.deepEqual(createTransferResult({ meta: { a: "", b: null, c: 1 } }).meta, { c: 1 });
});

test("createTransferResult coerces ok and normalizes error shapes", () => {
  assert.equal(createTransferResult({ ok: "yes" }).ok, false);
  assert.deepEqual(createTransferResult({ ok: false, error: "boom" }).error, {
    code: "TRANSFER_ERROR",
    message: "boom",
  });
  assert.deepEqual(
    createTransferResult({
      ok: false,
      status: TRANSFER_RESULT_STATUS.FAILED,
      error: { message: "bad", details: { at: "x" } },
    }).error,
    { code: "TRANSFER_ERROR", message: "bad", details: { at: "x" } },
  );
});

test("createTransferResult only keeps object envelopes", () => {
  assert.equal("envelope" in createTransferResult({ envelope: "x" }), false);
  assert.deepEqual(createTransferResult({ envelope: { transferId: "t" } }).envelope, {
    transferId: "t",
  });
});
