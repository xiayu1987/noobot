/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveContextMessageDialogProcessId } from "@noobot/context-protocol/message/codec";
import { normalizeDialogProcessId } from "@noobot/session-protocol";

test("resolveContextMessageDialogProcessId reads only the canonical dialogProcessId field", () => {
  assert.equal(resolveContextMessageDialogProcessId({ dialogProcessId: "d1" }), "d1");
  assert.equal(resolveContextMessageDialogProcessId({ dialogId: "d2" }), "");
});

test("normalizeDialogProcessId normalizes only the explicit value", () => {
  assert.equal(normalizeDialogProcessId(" d_current "), "d_current");
});
