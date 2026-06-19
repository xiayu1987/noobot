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
  buildPostPlanUserFollowupPrompt,
  buildGuidanceSummaryPromptText,
  buildGuidanceSummaryInstructionPromptText,
  buildGuidanceSummaryProtocolPromptText,
  buildGuidanceSummarySelectionProfileText,
  resolveGuidanceSummaryPromptProtocolSelection,
  buildPhaseAcceptanceRequestPromptText,
  buildPlanningMainPrompt,
  resolveWorkflowStrategyFromContext,
  buildWorkflowResponsibilityConstraintUserPrompt,
  buildTextScenarioConsumptionPolicyText,
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


test("summary prompts require file and line in every scenario, method only in programming mode", () => {
  const normalPrompt = buildGuidanceSummaryPromptText({ locale: "zh-CN" });
  assert.match(normalPrompt, /\[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(normalPrompt, /SUMMARY_DETAIL 后必须输出 \[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(normalPrompt, /必须整合上一轮小结结果/);
  assert.match(normalPrompt, /不得遗漏/);
  assert.doesNotMatch(normalPrompt, /\[next=下一步执行建议\]/);
  assert.match(normalPrompt, /file=\[文件路径\|-\]/);
  assert.match(normalPrompt, /line=\[行号\/行号范围\|-\]/);
  assert.match(normalPrompt, /\[file=-\]\[line=-\]/);
  assert.doesNotMatch(normalPrompt, /method=\[方法\/函数名\]/);

  const programmingPrompt = buildGuidanceSummaryPromptText({
    locale: "zh-CN",
    programmingMode: true,
  });
  assert.match(programmingPrompt, /\[NEXT_EXECUTION_SUGGESTION\]/);
  assert.match(programmingPrompt, /\[NEXT_ACTION\]/);
  assert.match(programmingPrompt, /action = edit\|test\|inspect\|ask_user\|final/);
  assert.match(programmingPrompt, /blocking = true\|false/);
  assert.match(programmingPrompt, /必须且只允许输出 1 个 \[NEXT_ACTION\]/);
  assert.match(programmingPrompt, /默认不要因普通风险点长期等待/g);
  assert.match(programmingPrompt, /Blocking risk（必须停）/);
  assert.match(programmingPrompt, /Managed risk（可先改但必须验证）/);
  assert.match(programmingPrompt, /Informational risk（只记录不阻塞）/);
  assert.match(programmingPrompt, /file=- method=- line=-/);
  assert.match(programmingPrompt, /禁止编造文件、函数或行号/);
  assert.match(programmingPrompt, /line 只有上下文存在明确行号时填写/);
  assert.match(programmingPrompt, /file=\[文件路径\|-\]/);
  assert.match(programmingPrompt, /method=\[方法\/函数名\|-\]/);
  assert.match(programmingPrompt, /line=\[行号\/行号范围\|-，可多段逗号分隔\]/);
  assert.match(programmingPrompt, /line=10-20,35,48-52/);
  assert.match(programmingPrompt, /编程模式.*file.*method.*line/);

  const normalProtocol = buildSummaryPatchProtocolText("en-US");
  assert.match(normalProtocol, /\[NEXT_EXECUTION_SUGGESTION\] after SUMMARY_DETAIL/);
  assert.match(normalProtocol, /integrate the previous summary results/);
  assert.match(normalProtocol, /do not omit still-valid previous items/);
  assert.doesNotMatch(normalProtocol, /next=\[next execution suggestion\]/);
  assert.match(normalProtocol, /file=\[file path\|-\]/);
  assert.match(normalProtocol, /line=\[line number\/range\|-\]/);
  assert.match(normalProtocol, /use file=- line=- when no location exists/);
  assert.doesNotMatch(normalProtocol, /method=\[method\/function name\]/);

  const programmingProtocol = buildSummaryPatchProtocolText({
    locale: "en-US",
    programmingMode: true,
  });
  assert.match(programmingProtocol, /exactly one \[NEXT_ACTION\] text block/);
  assert.match(programmingProtocol, /action=edit\|test\|inspect\|ask_user\|final/);
  assert.match(programmingProtocol, /blocking=true\|false/);
  assert.match(programmingProtocol, /file=- method=- line=-/);
  assert.match(programmingProtocol, /never fabricate file\/function\/line/);
  assert.match(programmingProtocol, /file=\[file path\|-\]/);
  assert.match(programmingProtocol, /method=\[method\/function name\|-\]/);
  assert.match(programmingProtocol, /line=\[line number\/range\|-; comma-separated multi-segments allowed\]/);
  assert.match(programmingProtocol, /file\/method\/line or -/);
});

test("summary selection matrix makes scenario mode prompt and protocol explicit", () => {
  const cases = [
    {
      options: { locale: "zh-CN" },
      scenario: "general",
      workflowMode: "base",
      promptId: "guidance_summary_instruction/general/base",
      protocolId: "summary_patch_v1/general/base",
      fields: ["plan", "status", "evidence", "file", "line"],
    },
    {
      options: { locale: "zh-CN", textMode: true, executionFirstMode: true },
      scenario: "text",
      workflowMode: "execution_first",
      promptId: "guidance_summary_instruction/text/execution_first",
      protocolId: "summary_patch_v1/text/execution_first",
      fields: ["plan", "status", "evidence", "file", "line", "path", "text"],
    },
    {
      options: { locale: "zh-CN", textMode: true, workflowStrategy: "risk_first" },
      scenario: "text",
      workflowMode: "risk_first",
      promptId: "guidance_summary_instruction/text/risk_first",
      protocolId: "summary_patch_v1/text/risk_first",
      fields: ["plan", "status", "evidence", "file", "line", "path", "text"],
    },
    {
      options: { locale: "zh-CN", programmingMode: true, workflowStrategy: "risk_first" },
      scenario: "programming",
      workflowMode: "execution_first",
      promptId: "guidance_summary_instruction/programming/execution_first",
      protocolId: "summary_patch_v1/programming/execution_first",
      fields: ["plan", "status", "evidence", "file", "method", "line"],
    },
  ];
  for (const item of cases) {
    const selection = resolveGuidanceSummaryPromptProtocolSelection(item.options);
    assert.equal(selection.scenario, item.scenario);
    assert.equal(selection.workflowMode, item.workflowMode);
    assert.equal(selection.instructionPromptId, item.promptId);
    assert.equal(selection.protocolId, item.protocolId);
    assert.deepEqual([...selection.protocolFields], item.fields);

    const profile = buildGuidanceSummarySelectionProfileText(item.options);
    assert.match(profile, new RegExp(`scenario = ${item.scenario}`));
    assert.match(profile, new RegExp(`workflow_mode = ${item.workflowMode}`));
    assert.match(profile, new RegExp(`instruction_prompt = ${item.promptId.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")}`));
    assert.match(profile, new RegExp(`patch_protocol = ${item.protocolId.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")}`));
  }
});

test("text scenario summary prompt consumes external text and records path/text separately from protocol", () => {
  const instruction = buildGuidanceSummaryInstructionPromptText({
    locale: "zh-CN",
    textMode: true,
    executionFirstMode: true,
  });
  assert.match(instruction, /文本场景附加建议/);
  assert.match(instruction, /外部文本信息一旦出现在用户输入、附件、工具结果、文件或其他来源中，建议在本轮优先消费并沉淀/);
  assert.match(instruction, /降低后续上下文裁剪导致丢失的风险/);
  assert.match(instruction, /\[path=docs\/input\.txt\]\[text=关键文本片段\/结论\]/);
  assert.match(instruction, /action = consume\|extract\|draft\|expand\|revise\|verify\|ask_user\|final/);
  assert.match(instruction, /batch_mode = deliverable_text_batch/);
  assert.match(instruction, /文本模式核心是多产出/);
  assert.doesNotMatch(instruction, /summary_patch_v1/);

  const protocol = buildGuidanceSummaryProtocolPromptText({
    locale: "zh-CN",
    textMode: true,
    executionFirstMode: true,
  });
  assert.match(protocol, /summary_patch_v1/);
  assert.match(protocol, /path=\[文件路径\|-\]/);
  assert.match(protocol, /text=\[关键文本内容\/原文片段\/结论\]/);
  assert.match(protocol, /SUMMARY_OVERVIEW 每条相关小结保持 file、line、path 与 text 字段完整/);
  assert.match(protocol, /action=consume\|extract\|draft\|expand\|revise\|verify\|ask_user\|final/);
  assert.match(protocol, /batch_mode=deliverable_text_batch/);
  assert.doesNotMatch(protocol, /iteration_mode=smallest_slice_loop/);

  const combined = buildGuidanceSummaryPromptText({
    locale: "zh-CN",
    textMode: true,
    workflowStrategy: "risk_first",
  });
  assert.match(combined, /文本场景外部文本消费建议/);
  assert.match(combined, /action = inspect\|verify\|mitigate\|ask_user\|final/);
  assert.match(combined, /path=\[文件路径\|-\]/);
});

test("non-programming execution-first prompts use generic next action without code locations", () => {
  const disabledPrompt = buildGuidanceSummaryPromptText({
    locale: "zh-CN",
    executionFirstMode: false,
  });
  assert.doesNotMatch(disabledPrompt, /action = do\|verify\|inspect\|ask_user\|final/);
  assert.doesNotMatch(disabledPrompt, /执行优先风险分级/);

  const prompt = buildGuidanceSummaryPromptText({
    locale: "zh-CN",
    executionFirstMode: true,
  });
  assert.match(prompt, /执行优先原则/);
  assert.match(prompt, /执行优先风险分级/);
  assert.match(prompt, /\[NEXT_ACTION\]/);
  assert.match(prompt, /action = do\|verify\|inspect\|ask_user\|final/);
  assert.match(prompt, /target = 对象\/动作\/问题/);
  assert.match(prompt, /iteration_mode = smallest_slice_loop/);
  assert.match(prompt, /next_slice = 下一最小切片/);
  assert.match(prompt, /last_check = 最近验证\/检查\|-/);
  assert.match(prompt, /result_state = done\|needs_fix\|blocked\|unknown/);
  assert.match(prompt, /artifact_path = 产物\/代码路径\|-/);
  assert.match(prompt, /validation_cmd = 验证命令\|-/);
  assert.match(prompt, /fallback_check = 替代检查\|-/);
  assert.match(prompt, /必须且只允许输出 1 个 \[NEXT_ACTION\]/);
  assert.match(prompt, /file=\[文件路径\|-\]/);
  assert.match(prompt, /line=\[行号\/行号范围\|-\]/);
  assert.doesNotMatch(prompt, /method=\[方法\/函数名\|-\]/);
  assert.doesNotMatch(prompt, /file=- method=- line=-/);

  const protocol = buildSummaryPatchProtocolText({
    locale: "zh-CN",
    executionFirstMode: true,
  });
  assert.match(protocol, /action=do\|verify\|inspect\|ask_user\|final/);
  assert.match(protocol, /target=对象\/动作\/问题/);
  assert.match(protocol, /iteration_mode=smallest_slice_loop/);
  assert.match(protocol, /next_slice=下一最小切片/);
  assert.match(protocol, /last_check=最近验证\/检查\|-/);
  assert.match(protocol, /result_state=done\|needs_fix\|blocked\|unknown/);
  assert.match(protocol, /artifact_path=产物\/代码路径\|-/);
  assert.match(protocol, /validation_cmd=验证命令\|-/);
  assert.match(protocol, /fallback_check=替代检查\|-/);
  assert.match(protocol, /file=\[文件路径\|-\]/);
  assert.match(protocol, /line=\[行号\/行号范围\|-\]/);
  assert.doesNotMatch(protocol, /method=\[方法\/函数名\|-\]/);
});

test("non-programming execution-first planning prompt stays plan-focused but action-first", () => {
  const prompt = buildPlanningMainPrompt({
    locale: "zh-CN",
    data: { userGoal: "整理会议纪要" },
    executionFirstMode: true,
  });
  assert.match(prompt, /目标：生成面向执行的最小可执行计划切片/);
  assert.match(prompt, /按最小切片循环执行（执行 -> 验证\/反馈 -> 修正 -> 继续），不断推进/);
  assert.match(prompt, /计划应倾向于：找到最相关入口 -> 做最小可逆动作/);
  assert.match(prompt, /执行优先风险分级/);
  assert.doesNotMatch(prompt, /生成用于编程执行的最小可执行计划切片/);
  assert.doesNotMatch(prompt, /做最小可逆修改 -> 运行局部测试\/构建/);
});

test("non-programming risk-first prompts use the same strategy pattern without code locations", () => {
  const prompt = buildGuidanceSummaryPromptText({
    locale: "zh-CN",
    workflowStrategy: "risk_first",
  });
  assert.match(prompt, /风险处理原则/);
  assert.match(prompt, /风险处理分级/);
  assert.doesNotMatch(prompt, /风险优先|风险.*消除|消除.*风险|风险.*解除/);
  assert.match(prompt, /\[NEXT_ACTION\]/);
  assert.match(prompt, /action = inspect\|verify\|mitigate\|ask_user\|final/);
  assert.match(prompt, /target = 风险点\/检查动作\/问题/);
  assert.match(prompt, /必须且只允许输出 1 个 \[NEXT_ACTION\]/);
  assert.match(prompt, /file=\[文件路径\|-\]/);
  assert.match(prompt, /line=\[行号\/行号范围\|-\]/);
  assert.doesNotMatch(prompt, /method=\[方法\/函数名\|-\]/);

  const planningPrompt = buildPlanningMainPrompt({
    locale: "zh-CN",
    data: { userGoal: "整理会议纪要" },
    workflowStrategy: "risk_first",
  });
  assert.match(planningPrompt, /目标：生成可执行的最小计划切片/);
  assert.match(planningPrompt, /非阻塞风险应写入验证动作并继续推进/);
  assert.doesNotMatch(planningPrompt, /消除.*风险|所有风险.*解除|只有风险.*才/);
  assert.doesNotMatch(planningPrompt, /生成用于编程执行/);

  const protocol = buildSummaryPatchProtocolText({
    locale: "zh-CN",
    riskFirstMode: true,
  });
  assert.match(protocol, /action=inspect\|verify\|mitigate\|ask_user\|final/);
  assert.match(protocol, /target=检查动作\/验证动作\/降级动作\/问题/);
  assert.match(protocol, /file=\[文件路径\|-\]/);
  assert.match(protocol, /line=\[行号\/行号范围\|-\]/);
});

test("programming scenario always resolves execution-first workflow strategy", () => {
  const strategy = resolveWorkflowStrategyFromContext(
    {
      runConfig: {
        scenario: "programming",
        plugins: {
          harness: {
            nonProgrammingWorkflowStrategy: "risk_first",
          },
        },
      },
    },
    {
      harness: {
        nonProgrammingWorkflowStrategy: "risk_first",
      },
    },
  );
  assert.equal(strategy, "execution_first");

  const prompt = buildPlanningMainPrompt({
    locale: "zh-CN",
    data: { userGoal: "修复 bug" },
    programmingMode: true,
    workflowStrategy: "risk_first",
  });
  assert.match(prompt, /生成用于编程执行的最小可执行计划切片/);
  assert.doesNotMatch(prompt, /风险降级的最小计划切片/);
});

test("post-plan followup prompt branches by execution-first workflow strategy", () => {
  const executionPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "planning", {
    executionFirstMode: true,
    workflowStrategy: "execution_first",
    riskFirstMode: false,
  });
  assert.match(executionPrompt, /执行优先/);
  assert.match(executionPrompt, /最小切片循环执行（执行 -> 验证\/反馈 -> 修正 -> 继续）/);
  assert.doesNotMatch(executionPrompt, /风险优先策略|风险优先/);

  const riskPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "revision", {
    executionFirstMode: false,
    workflowStrategy: "risk_first",
    riskFirstMode: true,
  });
  assert.match(riskPrompt, /按计划正常推进/);
  assert.match(riskPrompt, /非阻塞风险.*继续执行/);
  assert.doesNotMatch(riskPrompt, /先处理|风险优先|风险.*消除|消除.*风险|风险.*解除/);
  assert.doesNotMatch(riskPrompt, /执行优先|消除.*风险|所有风险.*解除/);

  const defaultPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "refinement");
  assert.match(defaultPrompt, /执行优先/);
  assert.match(defaultPrompt, /最小切片循环执行（执行 -> 验证\/反馈 -> 修正 -> 继续）/);
  assert.doesNotMatch(defaultPrompt, /风险优先策略|风险优先/);
});

test("post-plan followup prompt normalizes workflow strategy aliases", () => {
  const riskPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "planning", {
    workflowStrategy: "safety-first",
  });
  assert.doesNotMatch(riskPrompt, /执行优先|最小切片/);

  const executionPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "revision", {
    workflowStrategy: "actionFirst",
  });
  assert.match(executionPrompt, /执行优先/);
  assert.match(executionPrompt, /最小切片循环执行（执行 -> 验证\/反馈 -> 修正 -> 继续）/);
});


test("text scenario post-plan followup suggests consuming external text promptly", () => {
  const executionPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "planning", {
    scenario: "text",
    workflowStrategy: "execution_first",
  });
  assert.match(executionPrompt, /产出优先/);
  assert.match(executionPrompt, /文本场景/);
  assert.match(executionPrompt, /保真消费来源文本/);
  assert.match(executionPrompt, /可交付文本批次/);
  assert.match(executionPrompt, /外部文本.*拿到.*优先在本轮阅读、提取并消费/);
  assert.match(executionPrompt, /file、line、path、text/);
  assert.match(executionPrompt, /上下文裁剪.*丢失/);

  const riskPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "revision", {
    data: { scenario: "text" },
    workflowStrategy: "risk_first",
  });
  assert.match(riskPrompt, /按计划正常推进/);
  assert.match(riskPrompt, /外部文本.*优先在本轮阅读、提取并消费/);
  assert.doesNotMatch(riskPrompt, /先处理|风险优先|风险.*消除|消除.*风险|风险.*解除/);

  const generalPrompt = buildPostPlanUserFollowupPrompt("zh-CN", "planning", {
    workflowStrategy: "execution_first",
  });
  assert.doesNotMatch(generalPrompt, /file、line、path、text/);
});

test("text-mode post-plan followup follows text output policy from resolved flags", () => {
  const prompt = buildPostPlanUserFollowupPrompt("zh-CN", "planning", {
    textMode: true,
    workflowStrategy: "execution_first",
    executionFirstMode: true,
    riskFirstMode: false,
  });
  assert.match(prompt, /文本场景产出优先/);
  assert.match(prompt, /可交付文本批次/);
  assert.match(prompt, /保真消费来源文本/);
  assert.doesNotMatch(prompt, /最小切片循环执行/);
});

test("text scenario consumption wording is advisory instead of mandatory", () => {
  const texts = [
    buildTextScenarioConsumptionPolicyText("zh-CN"),
    buildGuidanceSummaryInstructionPromptText({ locale: "zh-CN", textMode: true }),
    buildGuidanceSummaryProtocolPromptText({ locale: "zh-CN", textMode: true }),
    buildPostPlanUserFollowupPrompt("zh-CN", "planning", { scenario: "text" }),
  ].join("\n");
  assert.match(texts, /建议|优先|尽量|降低/);
  assert.doesNotMatch(texts, /外部文本[^。；\n]*(必须|禁止|不得)/);
  assert.doesNotMatch(texts, /(必须|禁止|不得)[^。；\n]*外部文本/);
});

test("programming prompts add action-first execution principles only in programming mode", () => {
  const normalPlanningPrompt = buildPlanningMainPrompt({
    locale: "zh-CN",
    data: { userGoal: "修复 bug" },
  });
  assert.match(normalPlanningPrompt, /生成宏观主计划/);
  assert.doesNotMatch(normalPlanningPrompt, /默认不要因普通风险点长期等待/g);
  assert.doesNotMatch(normalPlanningPrompt, /最小可执行计划切片/);

  const programmingPlanningPrompt = buildPlanningMainPrompt({
    locale: "zh-CN",
    data: { userGoal: "修复 bug" },
    programmingMode: true,
  });
  assert.match(programmingPlanningPrompt, /生成用于编程执行的最小可执行计划切片/);
  assert.match(programmingPlanningPrompt, /最小切片循环执行（执行 -> 验证\/反馈 -> 修正 -> 继续）/);
  assert.match(programmingPlanningPrompt, /找到最相关入口 -> 做最小可逆修改 -> 运行局部测试\/构建 -> 根据失败信息修正 -> 继续下一切片或补充验收说明/);
  assert.doesNotMatch(programmingPlanningPrompt, /生成宏观主计划/);
  assert.match(programmingPlanningPrompt, /默认不要因普通风险点长期等待/g);
  assert.match(programmingPlanningPrompt, /修改 -> 验证 -> 修正/);
  assert.match(programmingPlanningPrompt, /Blocking risk（必须停）/);
  assert.match(programmingPlanningPrompt, /Managed risk（可先改但必须验证）/);
  assert.match(programmingPlanningPrompt, /Informational risk（只记录不阻塞）/);

  const normalResponsibilityPrompt = buildWorkflowResponsibilityConstraintUserPrompt(
    "zh-CN",
    "planning",
  );
  assert.doesNotMatch(normalResponsibilityPrompt, /默认不要因普通风险点长期等待/g);

  const programmingResponsibilityPrompt = buildWorkflowResponsibilityConstraintUserPrompt(
    "zh-CN",
    "planning",
    { programmingMode: true },
  );
  assert.match(programmingResponsibilityPrompt, /默认不要因普通风险点长期等待/g);
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
