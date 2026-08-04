/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildEngineErrorPayload } from "../../../src/runtime/errors/error-handler.js";
import { resolveErrorMessage } from "../../../src/shared/utils/error-utils.js";

test("structured abort identity is the canonical error message", () => {
  const error = { type: "user_stop" };

  assert.equal(resolveErrorMessage(error), "user_stop");
  const payload = buildEngineErrorPayload({ error });
  assert.equal(payload.classification, "abort");
  assert.equal(payload.message, "user_stop");
  assert.equal(payload.error.message, "user_stop");
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
