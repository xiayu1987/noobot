/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveLatestCompleteSummaryText,
  resolveLatestSummaryOutputFullText,
  resolveLatestSummaryRelayText,
} from "../src/capabilities/handlers/shared/plan/latest-summary-context.js";

test("resolveLatestCompleteSummaryText returns summaryFullText as the latest complete summary first", () => {
  const bucket = {
    summaryText: "1. overview fallback",
    summaryFullText: "[SUMMARY_OVERVIEW]\n1. full text wins\n[SUMMARY_DETAIL]\n- detail\n[SUMMARY_END]",
    guidanceOutputs: [
      { purpose: "summary", content: "1. older output" },
      { purpose: "summary", content: "1. newer output" },
    ],
  };

  assert.equal(
    resolveLatestCompleteSummaryText({ bucket }),
    "[SUMMARY_OVERVIEW]\n1. full text wins\n[SUMMARY_DETAIL]\n- detail\n[SUMMARY_END]",
  );
});

test("resolveLatestCompleteSummaryText falls back to latest summary guidance output before relay and overview", () => {
  const bucket = {
    summaryText: "1. overview fallback",
    guidanceOutputs: [
      { purpose: "guidance", content: "not summary" },
      { purpose: "summary", content: "1. older output" },
      { purpose: "summary", content: "1. latest output\n2. same complete summary" },
    ],
  };
  const ctx = {
    messages: [{ role: "user", content: "[来自harness外部模型输出/summary]\n1. relay fallback" }],
  };

  assert.equal(resolveLatestSummaryOutputFullText(bucket), "1. latest output\n2. same complete summary");
  assert.equal(
    resolveLatestCompleteSummaryText({ bucket, ctx }),
    "1. latest output\n2. same complete summary",
  );
});

test("resolveLatestCompleteSummaryText falls back to latest summary relay then summaryText", () => {
  const relayCtx = {
    messages: [
      { role: "user", content: "[来自harness外部模型输出/summary]\n1. old relay" },
      { role: "user", content: "[Relay from harness external model/summary]\n1. latest relay\n2. latest relay item" },
    ],
  };
  assert.equal(resolveLatestSummaryRelayText(relayCtx), "1. latest relay\n2. latest relay item");
  assert.equal(
    resolveLatestCompleteSummaryText({ bucket: { summaryText: "1. overview fallback" }, ctx: relayCtx }),
    "1. latest relay\n2. latest relay item",
  );
  assert.equal(
    resolveLatestCompleteSummaryText({ bucket: { summaryText: "1. overview fallback" }, ctx: {} }),
    "1. overview fallback",
  );
});
