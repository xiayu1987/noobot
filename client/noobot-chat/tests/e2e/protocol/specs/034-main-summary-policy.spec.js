/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import {
  createTaskSummaryReceipt,
  parseTaskSummaryContent,
} from "@noobot/context-protocol/task-summary-protocol";
import { resolveContextInternalMessageType } from "@noobot/context-protocol/injected-message-policy";
import {
  selectPlugins,
  sendMessage,
  setMainSummaryTurnsThreshold,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import {
  modelInvocationTraces,
  readSessionFact,
  readSessionTurnMessages,
  waitForSessionExecutionEventTree,
} from "../helpers/persistence-audit.js";
import {
  auditModelPrefixStability,
  isMainAgentModelInvocation,
} from "../helpers/model-message-assertions.js";
import { waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

function toolCallId(call = {}) {
  return String(call.id || call.tool_call_id || "").trim();
}

function toolResultName(message = {}) {
  if (message.role !== "tool") return "";
  return String(JSON.parse(String(message.content || "{}"))?.toolName || "").trim();
}

function toolCallName(call = {}) {
  return String(call.name || call.function?.name || "").trim();
}

function toolCallArgs(call = {}) {
  if (call.args && typeof call.args === "object") return call.args;
  return JSON.parse(String(call.function?.arguments || "{}"));
}

function messageContentHash(content = "") {
  return crypto.createHash("sha256").update(String(content)).digest("hex").slice(0, 16);
}

function assertSummarizedToolPairsAreClosed(messages, summarizedIds) {
  const summarized = messages.filter((message) => summarizedIds.has(message.messageUid));
  const assistantCallIds = new Set(summarized.flatMap((message) =>
    Array.isArray(message.tool_calls) ? message.tool_calls.map(toolCallId).filter(Boolean) : [],
  ));
  const toolResultIds = new Set(summarized
    .filter((message) => message.role === "tool")
    .map((message) => String(message.tool_call_id || "").trim())
    .filter(Boolean));
  expect(toolResultIds).toEqual(assistantCallIds);
}

test("@full PBE-034 主流程低轮次 task_summary checkpoint 与模型输入闭环", async ({ noobot, protocolCapture }, testInfo) => {
  test.setTimeout(900000);
  await selectPlugins(noobot.page, []);
  await setMainSummaryTurnsThreshold(noobot.page, 2);
  await sendMessage(noobot.page, uniquePrompt(testInfo, [
    "完成一个三步只读计算链。",
    "先调用 execute_script 生成一个随机十六进制 token；拿到实际 token 后，再调用 execute_script 计算该 token 的 SHA-256。",
    "最后调用 execute_script 从实际 SHA-256 中提取前八位。每一步必须使用前一步的实际输出，不得并行执行，最后汇总三个结果。",
  ].join(" ")));

  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  expect(send.preferences.summaryPolicy).toEqual({ phaseSummaryLoopTurns: 2 });
  expect(send.preferences.selectedPlugins).toEqual([]);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
    timeoutMs: 220000,
  });

  const records = await waitForSessionExecutionEventTree(noobot.userId, noobot.sessionId, (items) => {
    const scoped = items.filter((item) => item.turnScopeId === send.identity.turnScopeId);
    return scoped.some((item) => item.event === "phase_summary_required")
      && scoped.some((item) => item.event === "summary_checkpoint_committed")
      && modelInvocationTraces(scoped).filter(isMainAgentModelInvocation).length >= 3;
  });
  const scoped = records.filter((item) => item.turnScopeId === send.identity.turnScopeId);
  const summaryRequired = scoped.find((item) => item.event === "phase_summary_required");
  const checkpointEvent = scoped.find((item) => item.event === "summary_checkpoint_committed");
  expect(summaryRequired.data).toMatchObject({ loopThreshold: 2, trigger: "loop_turns" });
  expect(summaryRequired.data.loopCount).toBeGreaterThan(0);
  expect(summaryRequired.data.loopCount).toBeLessThanOrEqual(summaryRequired.data.loopThreshold);
  expect(checkpointEvent.data).toMatchObject({ exactCheckpoint: true });
  expect(checkpointEvent.data.summarizedMessageCount).toBeGreaterThan(0);

  const session = await readSessionFact(noobot.userId, noobot.sessionId);
  const checkpoint = session.turnSummaryCheckpoints?.[send.identity.turnScopeId];
  expect(checkpoint?.checkpointRevision).toBe(1);
  const receipts = Array.isArray(checkpoint.receipts) ? checkpoint.receipts : [];
  expect(receipts).toHaveLength(1);
  expect(checkpoint.checkpointRevision).toBe(receipts.length);
  const summarizedIds = new Set(receipts.flatMap((receipt) => receipt.summarizedMessageUids || []));
  expect(summarizedIds.size).toBeGreaterThan(0);

  const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  const messagesByUid = new Map(messages.map((message) => [message.messageUid, message]));
  for (const messageUid of summarizedIds) expect(messagesByUid.get(messageUid)?.summarized, messageUid).toBe(true);
  assertSummarizedToolPairsAreClosed(messages, summarizedIds);
  const phasePrompts = messages.filter((message) =>
    resolveContextInternalMessageType(message) === "noobot.phase_summary_prompt",
  );
  expect(phasePrompts).toHaveLength(1);
  expect(phasePrompts[0]).toMatchObject({ role: "user", type: "context_control", summarized: true });
  expect(summarizedIds.has(phasePrompts[0].messageUid)).toBe(true);

  const taskSummaryCalls = messages.flatMap((message) =>
    (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter((call) => toolCallName(call) === "task_summary")
      .map((call) => ({ message, call })),
  );
  expect(taskSummaryCalls).toHaveLength(1);
  const fullSummaryContent = String(toolCallArgs(taskSummaryCalls[0].call).summaryContent || "");
  const parsedSummary = parseTaskSummaryContent(fullSummaryContent);
  expect(parsedSummary.state).toBe("CONTINUE");
  const expectedReceipt = createTaskSummaryReceipt(parsedSummary);

  const taskSummaryResults = messages.filter((message) => toolResultName(message) === "task_summary");
  expect(taskSummaryResults).toHaveLength(1);
  const taskSummaryResultMessage = taskSummaryResults[0];
  const taskSummaryResult = JSON.parse(taskSummaryResultMessage.content);
  expect(taskSummaryResult.protocolVersion).toBe(1);
  expect(taskSummaryResult.summary).toEqual(expectedReceipt);
  expect(Object.keys(taskSummaryResult.summary).sort()).toEqual([
    "abstract",
    "contentHash",
    "nextAction",
    "state",
  ]);
  expect(taskSummaryResult.message).toBe("请根据小结后的状态、摘要和下一步处理后续流程。");
  expect(taskSummaryResultMessage.content.includes(fullSummaryContent)).toBe(false);
  expect(taskSummaryResult.summary.details).toBeUndefined();

  const summaryAttachmentFiles = (taskSummaryResultMessage.transferEnvelopes || [])
    .flatMap((envelope) => envelope.files || [])
    .filter((file) => file.name === "task-summary-content.tool-input.md");
  expect(summaryAttachmentFiles.length).toBeGreaterThan(0);
  expect(new Set(summaryAttachmentFiles.map((file) => file.attachmentId)).size).toBe(1);
  expect(await fs.readFile(summaryAttachmentFiles[0].path, "utf8")).toBe(fullSummaryContent);

  const mainInvocations = modelInvocationTraces(scoped).filter(isMainAgentModelInvocation);
  const mainPrefixAudit = auditModelPrefixStability(mainInvocations);
  expect(mainPrefixAudit.violations).toEqual([]);
  expect(mainPrefixAudit.stableComparisonCount).toBeGreaterThan(0);
  expect(mainPrefixAudit.checkpointRewriteCount).toBe(1);
  expect(mainInvocations.some((invocation) =>
    invocation.data.messages.preview.some((message) => message.messageId === phasePrompts[0].messageUid),
  )).toBe(true);
  for (const receipt of receipts) {
    const afterReceipt = mainInvocations.filter((record) =>
      Date.parse(record.ts || record.timestamp || "") >= Date.parse(receipt.committedAt),
    );
    expect(afterReceipt.length, receipt.checkpointId).toBeGreaterThan(0);
    for (const invocation of afterReceipt) {
      expect(invocation.data.messages.summarizedCount).toBe(0);
      const visibleIds = new Set(invocation.data.messages.preview.map((message) => message.messageId).filter(Boolean));
      for (const summarizedId of receipt.summarizedMessageUids) {
        expect(visibleIds.has(summarizedId), `${receipt.checkpointId}:${summarizedId}`).toBe(false);
      }
    }
  }
  const resultHash = messageContentHash(taskSummaryResultMessage.content);
  const invocationsReceivingReceipt = mainInvocations.filter((invocation) =>
    invocation.data.messages.preview.some((message) =>
      message.messageId === taskSummaryResultMessage.messageUid && message.contentHash === resultHash,
    ),
  );
  expect(invocationsReceivingReceipt.length).toBeGreaterThan(0);
  const toolResultNames = messages.map(toolResultName).filter(Boolean);
  expect(toolResultNames.filter((name) => name === "execute_script")).toHaveLength(3);
  expect(toolResultNames.filter((name) => name === "task_summary")).toHaveLength(1);
});
