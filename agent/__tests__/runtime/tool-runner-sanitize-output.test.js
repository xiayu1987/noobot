/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { executeToolCall } from "./core/tool-runner.test-helpers.js";
import { createTestRuntimeContext } from "../helpers/test-runtime-context.js";

const email = "alice@example.com";

function runtime(sanitizeOutput) {
  return createTestRuntimeContext({ systemRuntime: { config: { sanitizeOutput } } });
}

test("tool runner sanitizes successful output when enabled and preserves it when disabled", async () => {
  const tool = {
    invoke: async () => JSON.stringify({ toolName: "demo", ok: true, content: email }),
  };
  const sanitized = await executeToolCall({
    call: { id: "call-sanitized", name: "demo", args: {} },
    tool,
    runtime: runtime(true),
  });
  const raw = await executeToolCall({
    call: { id: "call-raw", name: "demo", args: {} },
    tool,
    runtime: runtime(false),
  });

  assert.doesNotMatch(sanitized.toolResultText, /alice@example\.com/);
  assert.equal(JSON.parse(raw.toolResultText).content, email);
});

test("tool runner applies the output sanitization preference to recoverable errors", async () => {
  const tool = {
    invoke: async () => {
      throw new Error(email);
    },
  };
  const sanitized = await executeToolCall({
    call: { id: "call-error-sanitized", name: "demo", args: {} },
    tool,
    runtime: runtime(true),
  });
  const raw = await executeToolCall({
    call: { id: "call-error-raw", name: "demo", args: {} },
    tool,
    runtime: runtime(false),
  });

  assert.doesNotMatch(sanitized.toolResultText, /alice@example\.com/);
  assert.match(raw.toolResultText, /alice@example\.com/);
});
