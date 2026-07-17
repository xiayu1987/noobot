import assert from "node:assert/strict";
import test from "node:test";

import { executeToolCall } from "../../../src/system-core/agent/core/execution/tool-runner.js";

const email = "alice@example.com";

function runtime(sanitizeOutput) {
  return {
    systemRuntime: { config: { sanitizeOutput } },
  };
}

test("tool runner sanitizes successful output by default and preserves it when disabled", async () => {
  const tool = { invoke: async () => email };
  const sanitized = await executeToolCall({ call: { name: "demo" }, tool, runtime: runtime(undefined) });
  const raw = await executeToolCall({ call: { name: "demo" }, tool, runtime: runtime(false) });

  assert.doesNotMatch(sanitized.toolResultText, /alice@example\.com/);
  assert.equal(raw.toolResultText, email);
});

test("tool runner applies the output sanitization preference to recoverable errors", async () => {
  const tool = { invoke: async () => { throw new Error(email); } };
  const sanitized = await executeToolCall({ call: { name: "demo" }, tool, runtime: runtime(true) });
  const raw = await executeToolCall({ call: { name: "demo" }, tool, runtime: runtime(false) });

  assert.doesNotMatch(sanitized.toolResultText, /alice@example\.com/);
  assert.match(raw.toolResultText, /alice@example\.com/);
});
