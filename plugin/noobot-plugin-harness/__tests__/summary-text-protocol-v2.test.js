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
import { buildGuidanceSummaryPromptText } from "../src/capabilities/handlers/shared/workflow/prompts.js";
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
  assert.match(programmingProtocol, /file=\[file path\]/);
  assert.match(programmingProtocol, /method=\[method\/function name\]/);
  assert.match(programmingProtocol, /line=\[line number\/range; comma-separated multi-segments allowed\]/);
  assert.match(programmingProtocol, /10-20,35,48-52/);
  assert.match(programmingProtocol, /programming mode.*file.*method.*line/i);
});
