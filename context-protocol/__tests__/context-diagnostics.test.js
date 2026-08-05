/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import assert from "node:assert/strict";
import test from "node:test";

import { summarizeDiagnosticMessages } from "../src/context-diagnostics.js";

test("context diagnostics records compact role and dialog dimensions", () => {
  const summary = summarizeDiagnosticMessages([
    { role: "user", content: "u1", dialogProcessId: "d1" },
    { role: "assistant", content: "a1", dialogProcessId: "d1" },
    { role: "user", content: "u2", dialogId: "d2", summarized: true },
    { role: "system", content: "system" },
  ], { limit: 1 });

  assert.deepEqual(summary.roles, { user: 2, assistant: 1, system: 1 });
  assert.deepEqual(summary.dialogGroups, [
    { dialogProcessId: "d1", count: 2 },
    { dialogProcessId: "d2", count: 1 },
  ]);
  assert.equal(summary.missingDialogIdCount, 1);
  assert.equal(summary.summarizedCount, 1);
  assert.equal(summary.preview.length, 1);
  assert.equal(summary.preview[0].contentLength, 2);
  assert.equal(summary.truncated, 3);
});
