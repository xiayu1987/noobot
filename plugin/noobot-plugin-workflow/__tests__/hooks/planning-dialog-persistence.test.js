/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkflowDialogRelativeDir } from "../../src/core/hooks/planning-dialog-persistence.js";

test("workflow dialog directory uses the explicit session and dialog identities", () => {
  assert.equal(
    buildWorkflowDialogRelativeDir({
      ctx: { sessionId: "session-1", runConfig: { sessionId: "other-session" } },
      dialogProcessId: "wf_node_node-1",
    }),
    "runtime/plugin-data/workflow/session/session-1/wf_node_node-1",
  );
});

test("workflow dialog directory rejects missing or noncanonical identities", () => {
  for (const value of [undefined, null, "", " ", " session-1 ", 1, {}]) {
    assert.throws(
      () =>
        buildWorkflowDialogRelativeDir({
          ctx: { sessionId: value, runConfig: { sessionId: "fallback-session" } },
          dialogProcessId: "dialog-1",
        }),
      /requires canonical session and dialog identity/,
    );
    assert.throws(
      () =>
        buildWorkflowDialogRelativeDir({
          ctx: { sessionId: "session-1", dialogProcessId: "fallback-dialog" },
          dialogProcessId: value,
        }),
      /requires canonical session and dialog identity/,
    );
  }
  assert.throws(() => buildWorkflowDialogRelativeDir(), TypeError);
  assert.throws(() => buildWorkflowDialogRelativeDir({}), TypeError);
});

test("workflow dialog directory retains workspace path segment validation", () => {
  for (const value of ["../other", "session/other", "session\\other"]) {
    assert.throws(
      () =>
        buildWorkflowDialogRelativeDir({ ctx: { sessionId: value }, dialogProcessId: "dialog-1" }),
      /invalid workspace path segment/,
    );
    assert.throws(
      () =>
        buildWorkflowDialogRelativeDir({ ctx: { sessionId: "session-1" }, dialogProcessId: value }),
      /invalid workspace path segment/,
    );
  }
});
