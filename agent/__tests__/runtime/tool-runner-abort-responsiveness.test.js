/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";

import { executeToolCall } from "./core/tool-runner.test-helpers.js";
import { isAbortError } from "../../src/shared/utils/error-utils.js";
import { createRuntimeContext } from "../../src/runtime/runtime-context-factory.js";

function runtime(abortSignal = null) {
  return createRuntimeContext({
    abortSignal,
    runConfig: {
      messageId: "message-abort-responsiveness",
      turnScopeId: "turn-abort-responsiveness",
      executionId: "run-abort-responsiveness",
    },
    systemRuntime: {
      sessionId: "session-abort-responsiveness",
      config: { sanitizeOutput: false },
    },
  });
}

test("tool runner aborts a tool that never observes the signal", async () => {
  const controller = new AbortController();
  let settled = false;
  let invoked = false;
  const tool = {
    invoke: async () => {
      invoked = true;
      return new Promise((resolve) => {
        setTimeout(() => {
          settled = true;
          resolve("late result");
        }, 60000).unref?.();
      });
    },
  };

  const pending = executeToolCall({
    call: { id: "call-abort", name: "demo" },
    tool,
    runtime: runtime(controller.signal),
  });

  controller.abort();

  await assert.rejects(pending, (error) => isAbortError(error, controller.signal));
  assert.equal(invoked, true);
  assert.equal(settled, false);
});

test("tool runner rejects immediately when the signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  let invoked = false;
  const tool = {
    invoke: async () => {
      invoked = true;
      return "result";
    },
  };

  await assert.rejects(
    executeToolCall({
      call: { id: "call-pre-aborted", name: "demo" },
      tool,
      runtime: runtime(controller.signal),
    }),
    (error) => isAbortError(error, controller.signal),
  );
  assert.equal(invoked, true);
});

test("tool runner still returns normal results when a signal is present but not aborted", async () => {
  const controller = new AbortController();
  const result = await executeToolCall({
    call: { id: "call-not-aborted", name: "demo" },
    tool: { invoke: async () => "ok" },
    runtime: runtime(controller.signal),
  });

  assert.equal(result.toolResultText, "ok");
});
