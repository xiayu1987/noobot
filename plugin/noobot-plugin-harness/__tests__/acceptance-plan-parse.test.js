/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildAcceptanceReport } from "../src/capabilities/handlers/acceptance/report-builder.js";
import {
  buildPlanChecklistSystemContent,
  resolveCompletePlanChecklistText,
  resolvePlanChecklistText,
} from "../src/capabilities/handlers/shared/plan/checklist-context.js";

test("acceptance report checklist includes first-level sub plans from planText", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: [
        "1. 主计划一",
        "1.1 子计划一",
        "1.2 子计划二",
        "2. 主计划二",
      ].join("\n"),
    },
    state: { locale: "zh-CN", signals: {} },
  });
  const checklist = Array.isArray(report?.taskChecklist) ? report.taskChecklist : [];
  assert.equal(checklist.length, 4);
  assert.equal(checklist[0].index, 1);
  assert.equal(checklist[1].index, 1.1);
  assert.equal(checklist[1].isMainStep, false);
  assert.equal(checklist[1].mainStepIndex, 1);
  assert.equal(checklist[2].index, 1.2);
  assert.equal(checklist[3].index, 2);
});

test("plan checklist context strips refinement patch appendix when plan text is parseable", () => {
  const text = resolvePlanChecklistText({
    planText: [
      "1. 主计划一",
      "1.1 子计划一",
      "2. 主计划二",
      "# planning_refinement",
      "ADD 1.2.1 非法二级子计划",
      "ADD 1.2 合法一级子计划补丁",
    ].join("\n"),
  });
  assert.match(String(text), /^1\. 主计划一/m);
  assert.match(String(text), /^1\.1 子计划一/m);
  assert.doesNotMatch(String(text), /planning_refinement/);
  assert.doesNotMatch(String(text), /^ADD /m);
});

test("summary checklist context preserves complete plan sub-plans from planText", () => {
  const content = buildPlanChecklistSystemContent({
    locale: "zh-CN",
    planText: [
      "1. 主计划一",
      "1.1 子计划一",
      "2. 主计划二",
      "2.1 子计划二一",
    ].join("\n"),
  });
  assert.match(String(content), /当前完整计划清单/);
  assert.match(String(content), /^1\.1 子计划一/m);
  assert.match(String(content), /^2\.1 子计划二一/m);
});

test("complete plan resolver preserves sub-plans from taskChecklist fallback", () => {
  const text = resolveCompletePlanChecklistText({
    bucket: {
      taskChecklist: [
        { index: 1, task: "主计划一", isMainStep: true },
        { index: 101, mainStepIndex: 1, isMainStep: false, task: "子计划一" },
        { index: 2, task: "主计划二", isMainStep: true },
        { index: 205, mainStepIndex: 2, isMainStep: false, task: "子计划二一" },
      ],
    },
  });
  assert.match(String(text), /^1\. 主计划一/m);
  assert.match(String(text), /^1\.1 子计划一/m);
  assert.match(String(text), /^2\. 主计划二/m);
  assert.match(String(text), /^2\.1 子计划二一/m);
});

test("complete plan resolver prefers bucket.planDocument over planText", () => {
  const text = resolveCompletePlanChecklistText({
    planText: "1. 旧主计划\n1.1 旧子计划",
    bucket: {
      planDocument: {
        mainPlans: [{ id: 1, content: "新主计划" }],
        subPlansByMainId: {
          1: [{ id: "1.1", mainId: 1, subIndex: 1, content: "新子计划" }],
        },
      },
    },
  });
  assert.match(String(text), /^1\. 新主计划/m);
  assert.match(String(text), /^1\.1 新子计划/m);
  assert.doesNotMatch(String(text), /旧主计划/);
});
