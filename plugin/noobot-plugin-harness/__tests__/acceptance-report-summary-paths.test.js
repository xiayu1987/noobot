/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applySemanticAcceptanceToReport,
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

test("before_final_output appends last acceptance report text to final output once", async () => {
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
  const first = await maybeAppendAcceptanceReportAtFinalOutput(ctx);
  assert.equal(first, true);
  assert.match(String(ctx?.result?.output || ""), /\n\n---\n/);
  assert.match(
    String(ctx?.result?.output || ""),
    /NOOBOT_HARNESS_COLLAPSE:start[^>]*kind="acceptance"[^>]*default="closed"/,
  );
  assert.match(String(ctx?.result?.output || ""), /\[Harness-验收\]/);
  assert.match(String(ctx?.result?.output || ""), /#### 完整计划清单/);
  assert.match(String(ctx?.result?.output || ""), /1\. \[pending\] 主计划一/);
  assert.match(String(ctx?.result?.output || ""), /#### 汇总/);
  assert.doesNotMatch(String(ctx?.result?.output || ""), /小结明细路径|summary detail/i);
  assert.doesNotMatch(String(ctx?.result?.output || ""), /runtime\/summary\/detail-2\.md/);
  assert.match(
    String(ctx?.result?.turnMessages?.[1]?.content || ""),
    /\n\n---\n/,
  );
  assert.match(
    String(ctx?.result?.turnMessages?.[1]?.content || ""),
    /\[Harness-验收\]/,
  );
  const second = await maybeAppendAcceptanceReportAtFinalOutput(ctx);
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

test("acceptance report maps latest model phase acceptance to checklist status and appends model result", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: "1. 确认用户意图与需求\n2. 提供相应的帮助与回应",
      phaseAcceptanceReports: [
        {
          acceptedAt: "2026-05-30T12:00:00.000Z",
          content: [
            "ADD A1 plan=1 status=pass risk=low evidence=用户打招呼\"你好\"，意图明确 [确认用户意图与需求：通过]",
            "ADD A2 plan=2 status=pass risk=low evidence=已给出回应 [提供相应的帮助与回应：通过]",
          ].join("\n"),
        },
      ],
    },
    state: { locale: "zh-CN", signals: {} },
  });
  const checklist = Array.isArray(report?.finalPlanChecklist) ? report.finalPlanChecklist : [];
  assert.equal(checklist.length >= 2, true);
  assert.equal(checklist[0]?.status, "completed");
  assert.equal(checklist[1]?.status, "completed");
  assert.match(String(report?.modelAcceptance?.rawContent || ""), /ADD A1 plan=1 status=pass/);

  const text = renderAcceptanceReportText(report, "zh-CN");
  assert.match(String(text), /## 模型验收结果/);
  assert.match(String(text), /ADD A2 plan=2 status=pass/);
});

test("acceptance report inherits main-plan model status to sub-plans when sub-plan status missing", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: [
        "1. 主计划一",
        "1.1 子计划一",
        "1.2 子计划二",
      ].join("\n"),
      phaseAcceptanceReports: [
        {
          acceptedAt: "2026-05-31T00:00:00.000Z",
          content: "ADD A1 plan=1 status=pass risk=low evidence=主计划完成 [主计划一：通过]",
        },
      ],
    },
    state: { locale: "zh-CN", signals: {} },
  });
  const checklist = Array.isArray(report?.finalPlanChecklist) ? report.finalPlanChecklist : [];
  assert.equal(checklist.length, 3);
  assert.equal(checklist[0]?.status, "completed");
  assert.equal(checklist[1]?.status, "completed");
  assert.equal(checklist[2]?.status, "completed");
});

test("acceptance report accepts bracketed plan id in model acceptance text", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: [
        "1. 主计划一",
        "1.1 子计划一",
      ].join("\n"),
      phaseAcceptanceReports: [
        {
          acceptedAt: "2026-05-31T00:00:00.000Z",
          content: "ADD A1 plan=[1.1] status=pass risk=low evidence=子计划一完成 [通过]",
        },
      ],
    },
    state: { locale: "zh-CN", signals: {} },
  });
  const checklist = Array.isArray(report?.finalPlanChecklist) ? report.finalPlanChecklist : [];
  assert.equal(checklist.length, 2);
  assert.equal(checklist[0]?.status, "pending");
  assert.equal(checklist[1]?.status, "completed");
});

test("semantic acceptance overrides phase checklist status and updates summary", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: [
        "1. 主计划一",
        "1.1 子计划一",
        "2. 主计划二",
      ].join("\n"),
      phaseAcceptanceReports: [
        {
          acceptedAt: "2026-05-31T00:00:00.000Z",
          content: [
            "ADD A1 plan=1 status=pass risk=low evidence=主计划一完成 [通过]",
            "ADD A2 plan=2 status=fail risk=high evidence=主计划二未完成 [未通过]",
          ].join("\n"),
        },
      ],
    },
    state: { locale: "zh-CN", signals: {} },
  });

  const before = Array.isArray(report?.finalPlanChecklist) ? report.finalPlanChecklist : [];
  assert.equal(before.length, 3);
  assert.equal(before[0]?.status, "completed");
  assert.equal(before[1]?.status, "completed");
  assert.equal(before[2]?.status, "pending");
  assert.equal(report?.summary?.completed, 2);
  assert.equal(report?.summary?.pending, 1);

  report.semanticValidation = {
    status: "pass",
    consistent: true,
    protocol: "text_patch",
    content: [
      "ADD A10 plan=1 status=fail risk=medium evidence=语义校验认为主计划一不满足 [未通过]",
      "ADD A11 plan=2 status=pass risk=low evidence=语义校验认为主计划二已满足 [通过]",
    ].join("\n"),
  };
  const applied = applySemanticAcceptanceToReport(report);
  assert.equal(applied, true);

  const after = Array.isArray(report?.finalPlanChecklist) ? report.finalPlanChecklist : [];
  assert.equal(after.length, 3);
  // semantic > phase：主计划1由 completed -> pending
  assert.equal(after[0]?.status, "pending");
  assert.equal(after[0]?.effectiveStatus, "pending");
  assert.equal(after[0]?.statusSource, "semantic");
  // 子计划1.1 继承主计划1的语义状态
  assert.equal(after[1]?.status, "pending");
  assert.equal(after[1]?.statusSource, "semantic");
  // 主计划2由 pending -> completed
  assert.equal(after[2]?.status, "completed");
  assert.equal(after[2]?.statusSource, "semantic");

  assert.equal(report?.summary?.total, 3);
  assert.equal(report?.summary?.completed, 1);
  assert.equal(report?.summary?.pending, 2);
  assert.equal(report?.statusAuthority, "semantic_over_phase_over_signal");
});

test("semantic acceptance fallback keeps phase/signal status when semantic text has no patch lines", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: "1. 主计划一",
      phaseAcceptanceReports: [
        {
          acceptedAt: "2026-05-31T00:00:00.000Z",
          content: "ADD A1 plan=1 status=pass risk=low evidence=主计划完成 [通过]",
        },
      ],
    },
    state: { locale: "zh-CN", signals: {} },
  });
  report.semanticValidation = {
    status: "pass",
    consistent: true,
    protocol: "text_patch",
    content: "语义一致，无需修改。",
  };
  const applied = applySemanticAcceptanceToReport(report);
  assert.equal(applied, false);
  const checklist = Array.isArray(report?.finalPlanChecklist) ? report.finalPlanChecklist : [];
  assert.equal(checklist[0]?.status, "completed");
});

test("before_final_output prepends latest complete summary before acceptance checklist", async () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: "1. 主计划一",
    },
    state: { locale: "zh-CN", signals: {} },
  });
  const ctx = {
    result: {
      output: "主流程回答",
      turnMessages: [{ role: "assistant", content: "主流程回答" }],
    },
    agentContext: {
      payload: {
        harness: {
          summaryText: "旧小结概览",
          summaryFullText: "完整小结：这是最后一次完整小结内容。",
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

  const appended = await maybeAppendAcceptanceReportAtFinalOutput(ctx);
  assert.equal(appended, true);
  const output = String(ctx?.result?.output || "");
  const summaryIndex = output.indexOf("## 最后一次完整小结");
  const acceptanceIndex = output.indexOf("[Harness-验收]");
  const summaryMarkerIndex = output.indexOf('kind="latest_complete_summary"');
  const acceptanceMarkerIndex = output.indexOf('kind="acceptance"');
  assert.equal(summaryIndex >= 0, true);
  assert.equal(acceptanceIndex >= 0, true);
  assert.equal(summaryMarkerIndex >= 0, true);
  assert.equal(acceptanceMarkerIndex >= 0, true);
  assert.equal(summaryMarkerIndex < acceptanceMarkerIndex, true);
  assert.equal(summaryIndex < acceptanceIndex, true);
  assert.match(output, /完整小结：这是最后一次完整小结内容。/);
  assert.match(output, /#### 完整计划清单[\s\S]*1\. \[pending\] 主计划一[\s\S]*#### 汇总/);
  assert.equal(ctx.result.turnMessages[0].content, ctx.result.output);
});
