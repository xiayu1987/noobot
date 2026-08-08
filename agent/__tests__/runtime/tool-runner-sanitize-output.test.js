/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { executeToolCall } from "../../src/runtime/tool-execution/tool-runner.js";

const email = "alice@example.com";

function runtime(sanitizeOutput) {
  return {
    runConfig: {
      messageId: "message-sanitize-output",
      turnScopeId: "turn-sanitize-output",
      executionId: "run-sanitize-output",
    },
    systemRuntime: {
      sessionId: "session-sanitize-output",
      config: { sanitizeOutput },
    },
  };
}

test("tool runner sanitizes successful output by default and preserves it when disabled", async () => {
  const tool = { invoke: async () => email };
  const sanitized = await executeToolCall({ call: { id: "call-sanitized", name: "demo" }, tool, sessionId: "session-sanitize-output", runtime: runtime(undefined) });
  const raw = await executeToolCall({ call: { id: "call-raw", name: "demo" }, tool, sessionId: "session-sanitize-output", runtime: runtime(false) });

  assert.doesNotMatch(sanitized.toolResultText, /alice@example\.com/);
  assert.equal(raw.toolResultText, email);
});

test("tool runner applies the output sanitization preference to recoverable errors", async () => {
  const tool = { invoke: async () => { throw new Error(email); } };
  const sanitized = await executeToolCall({ call: { id: "call-error-sanitized", name: "demo" }, tool, sessionId: "session-sanitize-output", runtime: runtime(true) });
  const raw = await executeToolCall({ call: { id: "call-error-raw", name: "demo" }, tool, sessionId: "session-sanitize-output", runtime: runtime(false) });

  assert.doesNotMatch(sanitized.toolResultText, /alice@example\.com/);
  assert.match(raw.toolResultText, /alice@example\.com/);
});
