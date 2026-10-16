/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import { buildAcceptanceReport } from "../../src/capabilities/handlers/acceptance/report-builder.js";
import { buildPlanChecklistSystemContent } from "../../src/capabilities/handlers/shared/plan/checklist-context.js";
import {
  applyPhaseAcceptanceReportToPlanStatus,
  resolvePlanAcceptanceForChecklistItem,
} from "../../src/capabilities/handlers/shared/plan/acceptance-status.js";
import { createChecklistItem } from "../../src/capabilities/handlers/shared/checklist-utils.js";

test("acceptance report checklist includes first-level sub plans from planText", () => {
  const report = buildAcceptanceReport({
    bucket: {
      planText: ["1. 主计划一", "1.1 子计划一", "1.2 子计划二", "2. 主计划二"].join("\n"),
    },
    state: { locale: "zh-CN", signals: {} },
  });
  assert.equal("taskChecklist" in report, false);
  assert.equal("planText" in report.plan, false);
  const checklist = report.finalPlanChecklist;
  assert.equal(checklist.length, 4);
  assert.deepEqual(checklist[0], {
    ...createChecklistItem({ mainId: 1, task: "主计划一" }),
    status: "pending",
    statusSource: "signal",
    planAcceptance: undefined,
    modelAcceptance: undefined,
  });
  assert.equal(checklist[0].index, "1");
  assert.equal(checklist[1].index, "1.1");
  assert.equal(checklist[1].isMainStep, false);
  assert.equal(checklist[1].mainStepIndex, 1);
  assert.equal(checklist[2].index, "1.2");
  assert.equal(checklist[3].index, "2");
});

test("summary checklist context preserves complete plan sub-plans from planText", () => {
  const content = buildPlanChecklistSystemContent({
    locale: "zh-CN",
    planText: ["1. 主计划一", "1.1 子计划一", "2. 主计划二", "2.1 子计划二一"].join("\n"),
  });
  assert.match(String(content), /当前完整计划清单/);
  assert.match(String(content), /^1\.1 子计划一/m);
  assert.match(String(content), /^2\.1 子计划二一/m);
});

test("plan checklist context includes planning-model current task goal from bucket", () => {
  const content = buildPlanChecklistSystemContent({
    locale: "zh-CN",
    planText: "1. 分析需求\n1.1 梳理约束",
    bucket: { currentTaskGoal: "计划模型提炼的当前任务目标" },
  });
  assert.match(String(content), /当前任务目标/);
  assert.match(String(content), /计划模型提炼的当前任务目标/);
  assert.match(String(content), /任务清单/);
  assert.match(String(content), /^1\.1 梳理约束/m);
});

test("phase acceptance status is written back to complete plan checklist context", () => {
  const bucket = {
    planText: ["1. 主计划一", "1.1 子计划一", "2. 主计划二"].join("\n"),
  };
  const reportEntry = {
    type: "phase",
    acceptedAt: "2026-01-01T00:00:00.000Z",
    planText: bucket.planText,
    content: "UPDATE A1 plan=1 status=pass risk=low evidence=done [通过]",
  };
  bucket.phaseAcceptanceReports = [reportEntry];
  const applied = applyPhaseAcceptanceReportToPlanStatus(bucket, reportEntry);
  assert.equal(applied.applied, true);

  const content = buildPlanChecklistSystemContent({
    locale: "zh-CN",
    planText: bucket.planText,
    bucket,
  });
  assert.match(String(content), /^1\. 主计划一 \[acceptance:completed, source:phase_acceptance\]/m);

  const report = buildAcceptanceReport({ bucket, state: { locale: "zh-CN", signals: {} } });
  assert.equal(report.finalPlanChecklist[0].status, "completed");
  assert.equal(report.finalPlanChecklist[0].statusSource, "plan_acceptance_status");
});

test("sub-plan acceptance resolves its parent only through mainStepIndex", () => {
  const bucket = { planAcceptanceStatusByPlanId: { 1: { planId: "1", status: "pass" } } };
  const item = createChecklistItem({ mainId: 1, subIndex: 7, task: "子计划" });
  assert.deepEqual(item, { index: "1.7", mainStepIndex: 1, isMainStep: false, task: "子计划" });
  assert.equal(resolvePlanAcceptanceForChecklistItem(bucket, item)?.status, "pass");
  assert.equal(
    resolvePlanAcceptanceForChecklistItem(bucket, {
      index: "1.7",
      isMainStep: false,
      parentIndex: 1,
    }),
    null,
  );
  assert.equal(resolvePlanAcceptanceForChecklistItem(bucket, { id: "1", isMainStep: true }), null);
});

test("sub-plan 1.10 keeps its own planId and never collides with 1.1", () => {
  const planText = ["1. 主计划一", "1.1 子计划一", "1.10 子计划十"].join("\n");
  const bucket = {
    planText,
    planAcceptanceStatusByPlanId: { "1.10": { planId: "1.10", status: "pass" } },
  };
  const report = buildAcceptanceReport({ bucket, state: { locale: "zh-CN", signals: {} } });
  const [, sub1, sub10] = report.finalPlanChecklist;
  assert.equal(sub1.index, "1.1");
  assert.equal(sub10.index, "1.10");
  assert.equal(sub1.status, "pending");
  assert.equal(sub10.status, "completed");
  assert.equal(sub10.statusSource, "plan_acceptance_status");
});
