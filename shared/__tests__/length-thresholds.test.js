/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import test from "node:test";
import { LENGTH_THRESHOLDS } from "../length-thresholds.js";

function collectLeafPaths(source, prefix = "") {
  const paths = [];
  for (const [key, value] of Object.entries(source)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      paths.push(...collectLeafPaths(value, path));
      continue;
    }
    paths.push([path, value]);
  }
  return paths;
}

test("every length threshold leaf is a finite positive number", () => {
  const leaves = collectLeafPaths(LENGTH_THRESHOLDS);
  assert.ok(leaves.length > 0);
  for (const [path, value] of leaves) {
    assert.equal(typeof value, "number", `${path} must be a number`);
    assert.ok(Number.isFinite(value), `${path} must be finite`);
    assert.ok(value > 0, `${path} must be positive`);
  }
});

test("length thresholds are deeply frozen", () => {
  assert.ok(Object.isFrozen(LENGTH_THRESHOLDS));
  assert.ok(Object.isFrozen(LENGTH_THRESHOLDS.display));
  assert.ok(Object.isFrozen(LENGTH_THRESHOLDS.contextPreview));
});

test("preview truncation groups stay converged on display and contextPreview", () => {
  assert.equal(LENGTH_THRESHOLDS.preview, undefined);
  assert.ok(LENGTH_THRESHOLDS.display);
  assert.ok(LENGTH_THRESHOLDS.contextPreview);
});

test("session summary truncation keys are resolvable from the display group", () => {
  const display = LENGTH_THRESHOLDS.display;
  for (const key of [
    "sessionSummaryTextChars",
    "sessionSummaryArrayItemChars",
    "sessionSummaryObjectFieldChars",
    "sessionSummaryDefaultJsonStringChars",
    "sessionSummarySmallJsonStringChars",
    "attachmentExtensionChars",
  ]) {
    assert.equal(typeof display[key], "number", `display.${key} must be defined`);
  }
});

test("memory parser and harness payload previews resolve from their owning groups", () => {
  assert.equal(typeof LENGTH_THRESHOLDS.memory.parserCandidatePreviewChars, "number");
  assert.equal(typeof LENGTH_THRESHOLDS.memory.parserRawPreviewChars, "number");
  assert.equal(typeof LENGTH_THRESHOLDS.harness.wrappedPayloadStringChars, "number");
});

test("context preview group only carries model context payload budgets", () => {
  assert.deepEqual(Object.keys(LENGTH_THRESHOLDS.contextPreview).sort(), [
    "harnessDynamicPolicyPromptChars",
    "planningCompactTextChars",
    "planningContextGoalChars",
    "workflowCompactTextChars",
    "workflowPayloadPreviewChars",
    "workflowResultTextChars",
    "workflowSemanticTextPreviewChars",
  ]);
});
