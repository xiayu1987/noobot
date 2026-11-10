/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildEngineErrorPayload } from "../../../src/runtime/errors/error-handler.js";
import { recoverableToolError, fatalSystemError } from "../../../src/shared/errors/index.js";
import { resolveErrorMessage } from "../../../src/shared/utils/error-utils.js";

test("upstream status is reported but never classifies an engine error as recoverable", () => {
  const errors = [
    { status: 429 },
    { statusCode: "429" },
    { error: { status: 429 } },
    { response: { status: 429 } },
    { cause: { status: 429 } },
    { cause: { statusCode: "429" } },
    { cause: { error: { status: 429 } } },
  ];
  for (const error of errors) {
    const payload = buildEngineErrorPayload({ error });
    assert.equal(payload.classification, "fatal");
    assert.equal(payload.error.status, 429);
  }
});

test("invalid upstream status is absent and never replaced by a lower-priority status", () => {
  for (const status of [0, -1, 429.5, "", " ", "invalid", false, true, {}, Infinity]) {
    const payload = buildEngineErrorPayload({ error: { status, cause: { status: 429 } } });
    assert.equal(payload.error.status, undefined);
    assert.equal(payload.classification, "fatal");
  }
  const payload = buildEngineErrorPayload({ error: { status: 401, cause: { status: 429 } } });
  assert.equal(payload.error.status, 401);
  assert.equal(payload.classification, "fatal");
});

test("upstream details preserve field precedence and header representations", () => {
  for (const headers of [new Headers({ "x-request-id": "req-1" }), { "x-request-id": "req-1" }]) {
    const payload = buildEngineErrorPayload({
      error: {
        error: { status: 503, code: "UPSTREAM", type: "provider_error" },
        cause: { code: "CAUSE", type: "cause_error", response: { headers } },
      },
    });
    assert.equal(payload.error.code, "UPSTREAM");
    assert.equal(payload.error.type, "provider_error");
    assert.equal(payload.error.requestId, "req-1");
  }
  const payload = buildEngineErrorPayload({
    error: { request_id: "primary", requestId: "secondary", headers: { "x-request-id": "header" } },
  });
  assert.equal(payload.error.requestId, "primary");
});

test("nested error messages are displayed without driving classification", () => {
  const error = { cause: { error: { message: "upstream temporarily unavailable" } } };
  const payload = buildEngineErrorPayload({ error });
  assert.equal(payload.classification, "fatal");
  assert.equal(payload.message, "upstream temporarily unavailable");
  assert.equal(buildEngineErrorPayload({ error: false }).message, "false");
});

test("explicit fatal and abort policies are independent of upstream status", () => {
  const error = fatalSystemError("fatal", { code: "FATAL", cause: { status: 429 } });
  assert.equal(buildEngineErrorPayload({ error }).classification, "fatal");
  const controller = new AbortController();
  controller.abort({ type: "user_stop", reason: "stopped" });
  assert.equal(
    buildEngineErrorPayload({ error, abortSignal: controller.signal }).classification,
    "abort",
  );
});

test("structured abort reason is the canonical error message", () => {
  const error = { type: "user_stop", reason: "stopped by user" };

  const payload = buildEngineErrorPayload({ error });
  assert.equal(payload.classification, "abort");
  assert.equal(payload.message, "stopped by user");
  assert.equal(payload.error.message, "stopped by user");
  assert.equal(payload.error.type, "user_stop");
});

test("error message resolution preserves messages and follows structured causes", () => {
  const abortError = new Error("Request was aborted.");
  abortError.name = "AbortError";
  assert.equal(resolveErrorMessage(abortError), "Request was aborted.");
  assert.equal(
    resolveErrorMessage({ cause: { error: { message: "upstream failed" } } }),
    "upstream failed",
  );
  assert.equal(resolveErrorMessage({ error: "nested failure" }), "nested failure");
  assert.equal(resolveErrorMessage("plain failure"), "plain failure");
  assert.equal(resolveErrorMessage({}), "");
});

test("engine abort payload uses the structured signal reason", () => {
  const controller = new AbortController();
  controller.abort({
    type: "run_timeout",
    reason: "run timeout after 18000000ms",
    timeoutMs: 18000000,
  });
  const error = new Error("Request was aborted.");
  error.name = "AbortError";

  const payload = buildEngineErrorPayload({ error, abortSignal: controller.signal });

  assert.equal(payload.classification, "abort");
  assert.equal(payload.message, "run timeout after 18000000ms");
  assert.equal(payload.error.message, "run timeout after 18000000ms");
  assert.equal(payload.error.type, "run_timeout");
});

test("errors raised after a user stop are classified as abort", () => {
  const controller = new AbortController();
  controller.abort({ type: "user_stop", reason: "user stop action" });
  const error = new TypeError("Cannot define property stack, object is not extensible");

  const payload = buildEngineErrorPayload({ error, abortSignal: controller.signal });

  assert.equal(payload.classification, "abort");
  assert.equal(payload.error.classification, "abort");
  assert.equal(payload.error.type, "user_stop");
  assert.equal(payload.message, "user stop action");
});

test("engine payload preserves the recoverable tool error classification", () => {
  const error = recoverableToolError("configured model was not found", {
    code: "RECOVERABLE_MODEL_NOT_FOUND",
  });

  const payload = buildEngineErrorPayload({ error });

  assert.equal(payload.classification, "recoverable");
  assert.deepEqual(
    ["retryable", "fatal", "abort"].filter((field) => Object.hasOwn(payload.error, field)),
    [],
  );
  assert.equal(payload.error.code, "RECOVERABLE_MODEL_NOT_FOUND");
});
