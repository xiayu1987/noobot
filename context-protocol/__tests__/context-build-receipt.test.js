/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createContextBuildReceipt } from "../src/context-build-receipt.js";

const scope = { sessionId: "s", dialogProcessId: "d", turnScopeId: "t" };

test("context build receipt is scoped and immutable", () => {
  const receipt = createContextBuildReceipt({ scope, mode: "existing_session", sourceRevision: "ctxsrc:1" });
  assert.equal(receipt.status, "ready");
  assert.equal(receipt.sourceRevision, "ctxsrc:1");
  assert.throws(() => { receipt.status = "failed"; }, TypeError);
});

test("failed context build receipt requires an error", () => {
  assert.throws(() => createContextBuildReceipt({ scope, status: "failed" }), /requires error/);
});
