/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  scheduleInjectTask,
  captureInjectedResult,
} from "../../src/capabilities/handlers/inject-fallback.js";
import { readAfterLlmCallText } from "../../src/capabilities/handlers/shared/message/utils.js";

test("readAfterLlmCallText reads normalized modelResponse.text only", () => {
  assert.equal(
    readAfterLlmCallText({ modelResponse: { text: " answer ", content: "<think>x</think>raw" } }),
    "answer",
  );
  assert.throws(() => readAfterLlmCallText({ ai: { content: "legacy" } }), TypeError);
});

test("inject fallback rejects missing callbacks", () => {
  assert.throws(() => scheduleInjectTask({}, { domain: "planning" }), TypeError);
  return assert.rejects(
    () => captureInjectedResult({}, { domain: "planning", isCapturePending: () => true }),
    TypeError,
  );
});
