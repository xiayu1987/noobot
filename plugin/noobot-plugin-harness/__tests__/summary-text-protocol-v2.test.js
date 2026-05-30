/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseSummaryOverviewAndDetailFromText } from "../src/capabilities/handlers/shared/plan/summary-text-protocol.js";

test("summary_text_v2 parser extracts overview and detail blocks", () => {
  const text = [
    "<!-- harness-guidance-summary-v2 -->",
    "[SUMMARY_OVERVIEW]",
    "1. [plan=2][status=done] 完成核心架构梳理",
    "2. [plan=3][status=risk] 发现容器并发冲突风险",
    "",
    "[SUMMARY_DETAIL]",
    "## 详细明细",
    "- 证据A",
    "- 风险B",
    "",
    "[SUMMARY_END]",
  ].join("\n");
  const parsed = parseSummaryOverviewAndDetailFromText(text);
  assert.equal(parsed.usedV2, true);
  assert.match(String(parsed.overviewText || ""), /\[plan=2\]\[status=done\]/);
  assert.match(String(parsed.detailText || ""), /^## 详细明细/m);
});

test("summary parser falls back to plain text when blocks missing", () => {
  const text = "1. 完成A\n2. 风险B";
  const parsed = parseSummaryOverviewAndDetailFromText(text);
  assert.equal(parsed.usedV2, false);
  assert.equal(parsed.overviewText, text);
  assert.equal(parsed.detailText, "");
});

