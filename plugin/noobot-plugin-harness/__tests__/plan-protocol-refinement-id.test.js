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
} from "../src/capabilities/handlers/shared/plan-text-protocol.js";
import { buildPlanningRefinementPromptText } from "../src/capabilities/handlers/shared/workflow-prompts.js";

test("refinement patch parser ignores two-level sub-plan ids like 1.1.1", () => {
  const patchText = [
    "ADD 1.1.1 非法二级子计划",
    "ADD 1.1 合法一级子计划",
  ].join("\n");
  const commands = parsePatchCommands(patchText);
  assert.equal(commands.length, 1);
  assert.equal(String(commands[0]?.target?.raw || ""), "1.1");
});

test("refinement apply patch only keeps one-level sub-plan ids", () => {
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
  assert.equal(doc.subPlansByMainId["1"].length, 1);
  assert.equal(String(doc.subPlansByMainId["1"][0]?.id || ""), "1.1");
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

