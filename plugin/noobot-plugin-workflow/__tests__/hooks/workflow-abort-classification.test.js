/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createExecutionAbortReason, EXECUTION_ABORT_TYPE } from "@noobot/session-protocol";

import { isWorkflowAbortError, throwIfWorkflowAborted } from "../../src/core/hooks/runtime.js";

test("plain errors mentioning abort are not workflow aborts", () => {
  const { signal } = new AbortController();
  assert.equal(isWorkflowAbortError(new Error("upstream request aborted"), signal), false);
  assert.equal(isWorkflowAbortError(new Error("dialog stopped by user"), signal), false);
});

test("structured abort errors and aborted signals are workflow aborts", () => {
  const reason = createExecutionAbortReason({
    type: EXECUTION_ABORT_TYPE.USER_STOP,
    reason: "user stop action",
  });
  assert.equal(isWorkflowAbortError(reason, new AbortController().signal), true);
  const controller = new AbortController();
  controller.abort(reason);
  assert.equal(isWorkflowAbortError(new Error("node failed"), controller.signal), true);
});

test("throwIfWorkflowAborted uses the structured abort reason text", () => {
  const controller = new AbortController();
  controller.abort(
    createExecutionAbortReason({ type: EXECUTION_ABORT_TYPE.RUN_TIMEOUT, reason: "run timeout" }),
  );
  assert.throws(
    () => throwIfWorkflowAborted(controller.signal),
    (error) => error.name === "AbortError" && error.message === "run timeout",
  );
});
