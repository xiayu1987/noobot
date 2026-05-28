/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildAcceptanceReport } from "../src/capabilities/handlers/acceptance/report-builder.js";
import { resolvePlanChecklistText } from "../src/capabilities/handlers/shared/plan/checklist-context.js";

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
