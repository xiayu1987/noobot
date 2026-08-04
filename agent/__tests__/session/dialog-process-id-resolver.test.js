/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveDialogProcessId,
  resolveDialogProcessIdFromContext,
  resolveMessageDialogProcessId,
} from "../../src/context/session/dialog-process-id-resolver.js";

test("resolveMessageDialogProcessId supports dialogProcessId and dialogId", () => {
  assert.equal(resolveMessageDialogProcessId({ dialogProcessId: "d1" }), "d1");
  assert.equal(resolveMessageDialogProcessId({ dialogId: "d2" }), "d2");
});

test("resolveDialogProcessIdFromContext reads only the explicit field", () => {
  assert.equal(resolveDialogProcessIdFromContext({ dialogProcessId: "d1" }), "d1");
  assert.equal(resolveDialogProcessIdFromContext({ runtime: { dialogProcessId: "legacy" } }), "");
});

test("resolveDialogProcessId reads only the explicit current context", () => {
  const id = resolveDialogProcessId({
    ctx: { dialogProcessId: "d_current" },
  });
  assert.equal(id, "d_current");
});
