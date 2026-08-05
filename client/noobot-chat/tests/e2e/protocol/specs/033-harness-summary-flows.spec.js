/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  selectPlugins,
  sendMessage,
  setHarnessCapability,
  setHarnessGuidanceAnalysisIntensity,
  setHarnessTurnsThreshold,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { assertCapabilityModelTraces, assertHarnessRun } from "../helpers/harness-assertions.js";
import {
  readSessionFact,
  readSessionTurnMessages,
  waitForHarnessRun,
} from "../helpers/persistence-audit.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

function capabilityEvents(records = []) {
  return records.flatMap((record) => Array.isArray(record?.capabilityLogs) ? record.capabilityLogs : []);
}

function toolResultName(message = {}) {
  if (message.role !== "tool") return "";
  return String(JSON.parse(String(message.content || "{}"))?.toolName || "").trim();
}

function assertCheckpointMessages(session, messages, turnScopeId) {
  const checkpoint = session.turnSummaryCheckpoints?.[turnScopeId];
  expect(checkpoint?.checkpointRevision).toBe(1);
  expect(checkpoint.dialogProcessId).toBeTruthy();
  const receipts = Array.isArray(checkpoint.receipts) ? checkpoint.receipts : [];
  expect(receipts).toHaveLength(1);
  const summarizedIds = new Set(receipts.flatMap((receipt) => receipt.summarizedMessageUids || []));
  expect(summarizedIds.size).toBeGreaterThan(0);
  const byUid = new Map(messages.map((message) => [message.messageUid, message]));
  for (const messageUid of summarizedIds) {
    expect(byUid.get(messageUid)?.summarized, messageUid).toBe(true);
  }
}

test("@full PBE-033 Harness 低轮次完整流程与小结数据闭环", async ({ noobot, protocolCapture }, testInfo) => {
  test.setTimeout(300_000);
  await selectPlugins(noobot.page, ["harness"]);
  await setHarnessCapability(noobot.page, "Planning", true);
  await setHarnessCapability(noobot.page, "Planning Acceptance", true);
  await setHarnessGuidanceAnalysisIntensity(noobot.page, 9);
  await setHarnessTurnsThreshold(noobot.page, "summary", 2);
  await setHarnessTurnsThreshold(noobot.page, "planUpdate", 3);
  await setHarnessTurnsThreshold(noobot.page, "phaseAcceptance", 1);

  await sendMessage(noobot.page, uniquePrompt(testInfo, [
    "完成一个五步只读计算链，每一步分别调用一次 execute_script。",
    "第一步调用 execute_script 生成一个随机十六进制 token；拿到实际 token 后，第二步调用 execute_script 计算该 token 的 SHA-256；",
    "第三步调用 execute_script 返回实际哈希的前八位；第四步调用 execute_script 反转该八位字符串；第五步调用 execute_script 返回反转后字符串的长度。",
    "后一步必须使用前一步的实际输出，不得并行执行，最后汇总五个实际结果。",
  ].join(" ")));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(send.preferences.pluginModelConfig.harness).toMatchObject({
    capabilityProfile: {
      planning: { enabled: true },
      acceptance: { enabled: true },
    },
    guidance: {
      analysis: { turnsThreshold: 2 },
      summary: { turnsThreshold: 2 },
    },
    planning: {
      planUpdate: { triggerTurnsThreshold: 3 },
    },
    acceptance: {
      phase: { triggerTurnsThreshold: 1 },
    },
  });
  const processing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    send.identity.turnScopeId,
  );
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
    timeoutMs: 280_000,
  });

  const requiredEvents = new Set([
    "planning_checklist_captured",
    "planning_revision_scheduled_by_turn_threshold",
    "guidance_analysis_scheduled_by_turn_threshold",
    "summary_scheduled_by_turn_threshold",
    "summary_generated_by_separate_model",
    "summary_messages_marked",
    "phase_acceptance_scheduled_by_turn_threshold",
    "phase_acceptance_completed",
    "acceptance_semantic_validation_completed",
    "review_report_generated",
  ]);
  const harness = await waitForHarnessRun(noobot.userId, processing.dialogProcessId, (candidate) => {
    const names = new Set(capabilityEvents(candidate.events).map((event) => event.event));
    return candidate.run?.status === "success" && [...requiredEvents].every((name) => names.has(name));
  }, { timeoutMs: 30_000 });
  assertHarnessRun(harness.run, { dialogProcessId: processing.dialogProcessId, status: "success" });
  assertCapabilityModelTraces(harness.capabilityTraces);

  const events = capabilityEvents(harness.events);
  for (const eventName of requiredEvents) expect(events.some((event) => event.event === eventName), eventName).toBe(true);
  const thresholdEvents = new Map([
    ["guidance_analysis_scheduled_by_turn_threshold", 2],
    ["planning_revision_scheduled_by_turn_threshold", 3],
    ["summary_scheduled_by_turn_threshold", 2],
    ["phase_acceptance_scheduled_by_turn_threshold", 1],
  ]);
  for (const [eventName, triggerTurns] of thresholdEvents) {
    const event = events.find((item) => item.event === eventName);
    expect(event.detail.triggerTurns, eventName).toBe(triggerTurns);
    expect(event.detail.thresholdSource, eventName).toBe("runtime");
  }
  const summaryMark = events.find((event) => event.event === "summary_messages_marked");
  expect(Number(summaryMark.detail?.markedCount || summaryMark.detail?.messageCount || 0)).toBeGreaterThan(0);

  const session = await readSessionFact(noobot.userId, noobot.sessionId);
  const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  assertCheckpointMessages(session, messages, send.identity.turnScopeId);
  const toolResultNames = messages.map(toolResultName).filter(Boolean);
  expect(toolResultNames.filter((name) => name === "execute_script")).toHaveLength(5);
});
