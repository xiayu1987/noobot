/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeSummaryText } from "../../src/capabilities/handlers/shared/plan/summary-text-protocol.js";
import { applySummaryText } from "../../src/capabilities/handlers/guidance/summary-manager.js";
import { createTestHookContext } from "../helpers/public-runtime-fixtures.js";

test("deleting all summary items returns an empty summary without restoring source text", () => {
  assert.equal(mergeSummaryText("1. obsolete\n2. resolved", "DELETE S1\nDELETE S2"), "");
  assert.equal(mergeSummaryText("", "DELETE S1"), "");
});

test("summary commands apply in order and preserve untouched items", () => {
  assert.equal(
    mergeSummaryText(
      "1. old\n2. keep\n3. remove",
      "UPDATE S1 updated\nDELETE S3\nADD S4 added\nDELETE S1\nADD S1 recreated",
    ),
    "1. recreated\n2. keep\n4. added",
  );
});

test("recognized commands do not fall through to numbered replacement or prose concatenation", () => {
  assert.equal(mergeSummaryText("1. old", "DELETE S1\n2. unrelated\nexplanation"), "");
  assert.equal(mergeSummaryText("1. keep", "DELETE S9"), "1. keep");
});

test("non-command summaries retain replacement, append and empty-input semantics", () => {
  assert.equal(mergeSummaryText("1. old", "2. replacement"), "2. replacement");
  assert.equal(mergeSummaryText("existing prose", "new prose"), "existing prose\nnew prose");
  assert.equal(mergeSummaryText("1. keep", "  "), "1. keep");
});

test("summary manager stores an empty command result and subsequent merges use that state", () => {
  const ctx = createTestHookContext({ agentContext: { bindings: {} } });
  assert.equal(applySummaryText(ctx, "1. obsolete"), "1. obsolete");
  assert.equal(applySummaryText(ctx, "DELETE S1"), "");
  assert.equal(ctx.agentContext.bindings.extensions.harness.summaryText, "");
  assert.equal(applySummaryText(ctx, "ADD S2 fresh"), "2. fresh");
});
