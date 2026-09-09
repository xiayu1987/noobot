/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_ATTEMPT_KIND,
  MODEL_ATTEMPT_STATUS,
  MODEL_ERROR_CODE,
  MODEL_ERROR_KIND,
  MODEL_REQUEST_STATUS,
  ModelProtocolError,
  requireModelAttemptKind,
  requireModelAttemptStatus,
} from "@noobot/model-protocol";

test("attempt vocabularies are frozen single sources", () => {
  assert.throws(() => {
    MODEL_ATTEMPT_STATUS.EXTRA = "extra";
  }, TypeError);
  assert.throws(() => {
    MODEL_ATTEMPT_KIND.EXTRA = "extra";
  }, TypeError);
});

test("attempt status carries the retry state that request status does not model", () => {
  assert.equal(MODEL_ATTEMPT_STATUS.RETRY, "retry");
  assert.ok(!Object.values(MODEL_REQUEST_STATUS).includes(MODEL_ATTEMPT_STATUS.RETRY));
  assert.ok(!Object.values(MODEL_ATTEMPT_STATUS).includes(MODEL_REQUEST_STATUS.CANCELLED));
});

test("attempt kind and error kind stay separate semantic slots despite the shared reasoning value", () => {
  assert.equal(MODEL_ATTEMPT_KIND.REASONING_ONLY, MODEL_ERROR_KIND.REASONING_ONLY);
  assert.ok(!Object.values(MODEL_ATTEMPT_KIND).includes(MODEL_ERROR_KIND.TOOL_CALL_MISMATCH));
  assert.ok(
    !Object.values(MODEL_ERROR_KIND).includes(MODEL_ATTEMPT_KIND.TOOL_CALL_STREAMING_MISMATCH),
  );
  assert.ok(!Object.values(MODEL_ERROR_KIND).includes(MODEL_ATTEMPT_KIND.TRANSPORT));
  assert.ok(!Object.values(MODEL_ERROR_KIND).includes(MODEL_ATTEMPT_KIND.RESPONSE));
});

test("attempt guards normalize whitespace and reject foreign vocabularies", () => {
  assert.equal(requireModelAttemptStatus("  completed  "), MODEL_ATTEMPT_STATUS.COMPLETED);
  assert.equal(requireModelAttemptKind("  transport  "), MODEL_ATTEMPT_KIND.TRANSPORT);
  assert.throws(() => requireModelAttemptStatus(""), /invalid model attempt status: missing/);
  assert.throws(() => requireModelAttemptKind(""), /invalid model attempt kind: missing/);
  assert.throws(() => requireModelAttemptStatus("COMPLETED"), /invalid model attempt status/);
  assert.throws(() => requireModelAttemptKind("chat"), /invalid model attempt kind: chat/);
  assert.throws(() => requireModelAttemptKind("web_search"), /invalid model attempt kind/);
  assert.throws(
    () => requireModelAttemptKind(MODEL_ERROR_KIND.TOOL_CALL_MISMATCH),
    /invalid model attempt kind: tool_call_mismatch/,
  );
});

test("protocol error defaults come from the protocol vocabularies", () => {
  const error = new ModelProtocolError("boom");
  assert.equal(error.code, MODEL_ERROR_CODE.PROTOCOL);
  assert.equal(error.kind, MODEL_ERROR_KIND.UNKNOWN);
  assert.equal(error.retryable, false);
});
