/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  applyPatchCommandsToPlanDocument,
  parsePatchCommands,
} from "../src/capabilities/handlers/shared/plan/text-protocol.js";
import { buildPlanningRefinementPromptText } from "../src/capabilities/handlers/shared/workflow/prompts.js";

test("refinement patch parser accepts deep ids like 1.1.1 for flatten fallback", () => {
  const patchText = [
    "ADD 1.1.1 非法二级子计划",
    "ADD 1.1 合法一级子计划",
  ].join("\n");
  const commands = parsePatchCommands(patchText);
  assert.equal(commands.length, 2);
  assert.equal(String(commands[0]?.target?.raw || ""), "1.1.1");
  assert.equal(Number(commands[0]?.target?.depth || 0), 3);
  assert.equal(String(commands[1]?.target?.raw || ""), "1.1");
});

test("refinement patch parser accepts canonical bracketed ids from prompt examples", () => {
  const patchText = [
    "ADD [1.1] 子计划A",
    "UPDATE [1.2] 子计划B",
    "DELETE [1.3]",
  ].join("\n");
  const commands = parsePatchCommands(patchText);
  assert.equal(commands.length, 3);
  assert.equal(String(commands[0]?.target?.raw || ""), "1.1");
  assert.equal(String(commands[1]?.target?.raw || ""), "1.2");
  assert.equal(String(commands[2]?.target?.raw || ""), "1.3");
});

test("refinement apply patch flattens deep sub-plan ids into one-level sub-plans", () => {
  const doc = {
    mainPlans: [{ id: 1, content: "主步骤一" }],
    subPlansByMainId: {},
  };
  const patchText = [
    "ADD 1.1.1 非法二级子计划",
    "ADD 1.1 合法一级子计划",
  ].join("\n");
  const result = applyPatchCommandsToPlanDocument(doc, patchText, { stage: "refinement" });
  assert.equal(result.changed, true);
  assert.equal(Array.isArray(doc.subPlansByMainId["1"]), true);
  assert.equal(doc.subPlansByMainId["1"].length, 2);
  assert.equal(String(doc.subPlansByMainId["1"][0]?.id || ""), "1.1");
  assert.equal(String(doc.subPlansByMainId["1"][1]?.id || ""), "1.2");
});

test("refinement ADD with duplicated sub-plan id auto-allocates next available id", () => {
  const doc = {
    mainPlans: [{ id: 1, content: "主步骤一" }],
    subPlansByMainId: {
      "1": [{ id: "1.1", mainId: 1, subIndex: 1, content: "已存在子计划" }],
    },
  };
  const patchText = "ADD 1.1 新增子计划（模型误用重复ID）";
  const result = applyPatchCommandsToPlanDocument(doc, patchText, { stage: "refinement" });
  assert.equal(result.changed, true);
  assert.equal(Array.isArray(doc.subPlansByMainId["1"]), true);
  assert.equal(doc.subPlansByMainId["1"].length, 2);
  assert.equal(String(doc.subPlansByMainId["1"][0]?.id || ""), "1.1");
  assert.equal(String(doc.subPlansByMainId["1"][1]?.id || ""), "1.2");
});

test("refinement prompt explicitly forbids two-level sub-plan ids", () => {
  const prompt = buildPlanningRefinementPromptText({
    locale: "zh-CN",
    marker: "<!-- harness-planning-refinement -->",
    data: {
      targetId: 1,
      targetContent: "主步骤一",
      existingSubPlansText: "",
      feedback: "",
    },
  });
  assert.match(String(prompt), /禁止输出 1\.1\.1/);
});

test("refinement prompt supports multiple target main plan ids", () => {
  const prompt = buildPlanningRefinementPromptText({
    locale: "zh-CN",
    marker: "<!-- harness-planning-refinement -->",
    data: {
      targetIds: [2, 3],
      targetPlansText: "2. 主步骤二\n3. 主步骤三",
      existingSubPlansText: "主计划 2:\n（空）\n\n主计划 3:\n（空）",
      feedback: "",
    },
  });
  assert.match(String(prompt), /本次需要细化的主计划ID/);
  assert.match(String(prompt), /\[2,3\]/);
});
