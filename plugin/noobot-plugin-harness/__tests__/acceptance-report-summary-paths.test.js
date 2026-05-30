/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAcceptanceReport,
  renderAcceptanceReportText,
} from "../src/capabilities/handlers/acceptance/report-builder.js";
import { maybeAppendAcceptanceReportAtFinalOutput } from "../src/capabilities/handlers/acceptance/output-finalizer.js";

test("acceptance report includes summary detail paths", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: "1. 主计划一",
      summaryDetailPaths: ["runtime/summary/detail-1.md"],
    },
    state: { locale: "zh-CN", signals: {} },
  });
  assert.equal(Array.isArray(report?.summaryDetailPaths), true);
  assert.equal(report.summaryDetailPaths.includes("runtime/summary/detail-1.md"), true);
  const text = renderAcceptanceReportText(report, "zh-CN");
  assert.match(String(text), /小结明细路径/);
  assert.match(String(text), /runtime\/summary\/detail-1\.md/);
});

test("before_final_output appends last acceptance report text to final output once", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: "1. 主计划一",
      summaryDetailPaths: ["runtime/summary/detail-2.md"],
    },
    state: { locale: "zh-CN", signals: {} },
  });
  const ctx = {
    result: {
      output: "主流程回答",
      turnMessages: [
        { role: "user", content: "问题" },
        { role: "assistant", content: "主流程回答" },
      ],
    },
    agentContext: {
      payload: {
        harness: {
          state: {
            locale: "zh-CN",
            flags: { acceptanceReportAppendedToFinalOutput: false },
            counters: {},
            signals: {},
            pending: {},
          },
          lastAcceptanceReport: report,
          logs: { planning: [], guidance: [], acceptance: [], review: [] },
        },
      },
    },
  };
  const first = maybeAppendAcceptanceReportAtFinalOutput(ctx);
  assert.equal(first, true);
  assert.match(String(ctx?.result?.output || ""), /\n\n---\n/);
  assert.match(String(ctx?.result?.output || ""), /\[Harness-验收\]/);
  assert.match(
    String(ctx?.result?.turnMessages?.[1]?.content || ""),
    /\n\n---\n/,
  );
  assert.match(
    String(ctx?.result?.turnMessages?.[1]?.content || ""),
    /\[Harness-验收\]/,
  );
  const second = maybeAppendAcceptanceReportAtFinalOutput(ctx);
  assert.equal(second, false);
});

test("renderAcceptanceReportText falls back to raw text when recognition fails", () => {
  const text = renderAcceptanceReportText(
    {
      mode: "active",
      finalPlanChecklist: [{ index: 1, task: "", status: "unknown_status" }],
      summary: { total: 1, completed: 0, inProgress: 0, pending: 1 },
    },
    "zh-CN",
  );
  assert.match(String(text), /\[Harness-验收\]/);
  assert.match(String(text), /mode: active/);
  assert.doesNotMatch(String(text), /## 模式/);
});
