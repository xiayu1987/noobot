/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseSummaryOverviewAndDetailFromText,
  parseSummaryPatchCommands,
  resolveSummaryDetailAttachmentText,
} from "../src/capabilities/handlers/shared/plan/summary-text-protocol.js";
import {
  buildAcceptanceValidationRequestPromptText,
  buildGuidanceSummaryPromptText,
  buildPhaseAcceptanceRequestPromptText,
  buildPlanningMainPrompt,
  buildWorkflowResponsibilityConstraintUserPrompt,
} from "../src/capabilities/handlers/shared/workflow/prompts.js";
import { buildSummaryPatchProtocolText } from "../src/capabilities/handlers/shared/workflow/protocols.js";

test("summary_text_v2 parser extracts overview and detail blocks", () => {
  const text = [
    "<!-- harness-guidance-summary-v2 -->",
    "[SUMMARY_OVERVIEW]",
    "1. [plan=2][status=done][file=src/a.js][method=bootstrap][line=12] 完成核心架构梳理",
    "2. [plan=8][status=todo][risk=高][file=src/b.js][method=runWorker][line=20-35,40,55-60] 并发冲突风险，影响任务稳定性，建议先加互斥锁与回归验证",
    "",
    "[SUMMARY_DETAIL]",
    "## 详细明细",
    "- 证据A",
    "- 风险B",
    "",
    "[NEXT_EXECUTION_SUGGESTION]",
    "- 下一步先处理风险B，并补充回归验证",
    "",
    "[SUMMARY_END]",
  ].join("\n");
  const parsed = parseSummaryOverviewAndDetailFromText(text);
  assert.equal(parsed.usedV2, true);
  assert.match(String(parsed.overviewText || ""), /\[plan=2\]\[status=done\]\[file=src\/a\.js\]\[method=bootstrap\]\[line=12\]/);
  assert.match(String(parsed.overviewText || ""), /\[plan=8\]\[status=todo\]\[risk=高\]\[file=src\/b\.js\]\[method=runWorker\]\[line=20-35,40,55-60\]/);
  assert.match(String(parsed.detailText || ""), /^## 详细明细/m);
  assert.doesNotMatch(String(parsed.detailText || ""), /\[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(String(parsed.nextSuggestionText || ""), /下一步先处理风险B/);
  assert.match(resolveSummaryDetailAttachmentText(parsed), /\[NEXT_EXECUTION_SUGGESTION\]\n- 下一步先处理风险B/);
});

test("summary parser falls back to plain text when blocks missing", () => {
  const text = "1. 完成A\n2. 风险B";
  const parsed = parseSummaryOverviewAndDetailFromText(text);
  assert.equal(parsed.usedV2, false);
  assert.equal(parsed.overviewText, text);
  assert.equal(parsed.detailText, "");
});

test("summary patch parser accepts protocol IDs with S prefix and bracketed numbers", () => {
  const commands = parseSummaryPatchCommands([
    "ADD S1 plan=1 status=done 完成主计划一",
    "UPDATE S[2] status=todo 存在风险",
    "DELETE S3",
    "ADD 4 plan=4 status=done 兼容旧格式",
  ].join("\n"));
  assert.equal(commands.length, 4);
  assert.deepEqual(commands.map((item) => item.id), [1, 2, 3, 4]);
  assert.equal(commands[0].action, "ADD");
  assert.equal(commands[1].action, "UPDATE");
  assert.equal(commands[2].action, "DELETE");
});


test("summary prompts require file method and multi-segment line only in programming mode", () => {
  const normalPrompt = buildGuidanceSummaryPromptText({ locale: "zh-CN" });
  assert.match(normalPrompt, /\[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(normalPrompt, /SUMMARY_DETAIL 后必须输出 \[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(normalPrompt, /必须整合上一轮小结结果/);
  assert.match(normalPrompt, /不得遗漏/);
  assert.doesNotMatch(normalPrompt, /\[next=下一步执行建议\]/);
  assert.doesNotMatch(normalPrompt, /file=\[文件路径\]/);
  assert.doesNotMatch(normalPrompt, /method=\[方法\/函数名\]/);
  assert.doesNotMatch(normalPrompt, /line=\[行号\/行号范围/);

  const programmingPrompt = buildGuidanceSummaryPromptText({
    locale: "zh-CN",
    programmingMode: true,
  });
  assert.match(programmingPrompt, /\[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(programmingPrompt, /\[NEXT_ACTION\]/);
  assert.match(programmingPrompt, /action = edit\|test\|inspect\|ask_user\|final/);
  assert.match(programmingPrompt, /blocking = true\|false/);
  assert.match(programmingPrompt, /必须且只允许输出 1 个 \[NEXT_ACTION\]/);
  assert.match(programmingPrompt, /默认不要等待所有风险点解除/);
  assert.match(programmingPrompt, /Blocking risk（必须停）/);
  assert.match(programmingPrompt, /Managed risk（可先改但必须验证）/);
  assert.match(programmingPrompt, /Informational risk（只记录不阻塞）/);
  assert.match(programmingPrompt, /file=\[文件路径\]/);
  assert.match(programmingPrompt, /method=\[方法\/函数名\]/);
  assert.match(programmingPrompt, /line=\[行号\/行号范围，可多段逗号分隔\]/);
  assert.match(programmingPrompt, /line=10-20,35,48-52/);
  assert.match(programmingPrompt, /编程模式.*file.*method.*line/);

  const normalProtocol = buildSummaryPatchProtocolText("en-US");
  assert.match(normalProtocol, /\[NEXT_EXECUTION_SUGGESTION\] after SUMMARY_DETAIL/);
  assert.match(normalProtocol, /integrate the previous summary results/);
  assert.match(normalProtocol, /do not omit still-valid previous items/);
  assert.doesNotMatch(normalProtocol, /next=\[next execution suggestion\]/);
  assert.doesNotMatch(normalProtocol, /file=\[file path\]/);
  assert.doesNotMatch(normalProtocol, /method=\[method\/function name\]/);
  assert.doesNotMatch(normalProtocol, /line=\[line number\/range/);

  const programmingProtocol = buildSummaryPatchProtocolText({
    locale: "en-US",
    programmingMode: true,
  });
  assert.match(programmingProtocol, /exactly one \[NEXT_ACTION\] text block/);
  assert.match(programmingProtocol, /action=edit\|test\|inspect\|ask_user\|final/);
  assert.match(programmingProtocol, /blocking=true\|false/);
  assert.match(programmingProtocol, /file=\[file path\]/);
  assert.match(programmingProtocol, /method=\[method\/function name\]/);
  assert.match(programmingProtocol, /line=\[line number\/range; comma-separated multi-segments allowed\]/);
  assert.match(programmingProtocol, /10-20,35,48-52/);
  assert.match(programmingProtocol, /programming mode.*file.*method.*line/i);
});

test("programming prompts add action-first execution principles only in programming mode", () => {
  const normalPlanningPrompt = buildPlanningMainPrompt({
    locale: "zh-CN",
    data: { userGoal: "修复 bug" },
  });
  assert.match(normalPlanningPrompt, /生成宏观主计划/);
  assert.doesNotMatch(normalPlanningPrompt, /默认不要等待所有风险点解除/);
  assert.doesNotMatch(normalPlanningPrompt, /最小可执行计划切片/);

  const programmingPlanningPrompt = buildPlanningMainPrompt({
    locale: "zh-CN",
    data: { userGoal: "修复 bug" },
    programmingMode: true,
  });
  assert.match(programmingPlanningPrompt, /生成用于编程执行的最小可执行计划切片/);
  assert.match(programmingPlanningPrompt, /找到最相关入口 -> 做最小可逆修改 -> 运行局部测试\/构建 -> 根据失败信息修正 -> 最后补充验收说明/);
  assert.doesNotMatch(programmingPlanningPrompt, /生成宏观主计划/);
  assert.match(programmingPlanningPrompt, /默认不要等待所有风险点解除/);
  assert.match(programmingPlanningPrompt, /修改 -> 验证 -> 修正/);
  assert.match(programmingPlanningPrompt, /Blocking risk（必须停）/);
  assert.match(programmingPlanningPrompt, /Managed risk（可先改但必须验证）/);
  assert.match(programmingPlanningPrompt, /Informational risk（只记录不阻塞）/);

  const normalResponsibilityPrompt = buildWorkflowResponsibilityConstraintUserPrompt(
    "zh-CN",
    "planning",
  );
  assert.doesNotMatch(normalResponsibilityPrompt, /默认不要等待所有风险点解除/);

  const programmingResponsibilityPrompt = buildWorkflowResponsibilityConstraintUserPrompt(
    "zh-CN",
    "planning",
    { programmingMode: true },
  );
  assert.match(programmingResponsibilityPrompt, /默认不要等待所有风险点解除/);
  assert.match(programmingResponsibilityPrompt, /未知点应转化为验证动作/);
  assert.match(programmingResponsibilityPrompt, /只有这类风险可以阻止代码修改/);
});

test("programming acceptance prompts include risk taxonomy without changing text protocol", () => {
  const normalPhasePrompt = buildPhaseAcceptanceRequestPromptText({
    locale: "zh-CN",
    data: { requestPayload: { acceptanceType: "phase" } },
  });
  assert.match(normalPhasePrompt, /验收 ID\+PATCH 协议/);
  assert.doesNotMatch(normalPhasePrompt, /Blocking risk（必须停）/);

  const programmingPhasePrompt = buildPhaseAcceptanceRequestPromptText({
    locale: "zh-CN",
    data: { requestPayload: { acceptanceType: "phase" } },
    programmingMode: true,
  });
  assert.match(programmingPhasePrompt, /验收 ID\+PATCH 协议/);
  assert.match(programmingPhasePrompt, /Blocking risk（必须停）/);
  assert.match(programmingPhasePrompt, /Managed risk（可先改但必须验证）/);
  assert.match(programmingPhasePrompt, /Informational risk（只记录不阻塞）/);

  const programmingFinalPrompt = buildAcceptanceValidationRequestPromptText({
    locale: "zh-CN",
    data: { requestPayload: { finalOutput: "done" } },
    programmingMode: true,
  });
  assert.match(programmingFinalPrompt, /验收 ID\+PATCH 协议/);
  assert.match(programmingFinalPrompt, /只有这类风险可以阻止代码修改/);
});
