/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import fs from "node:fs/promises";
import { clientFilePath as path } from "@noobot/client-shared/path-resolver";
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
  readAttachmentIndex,
  readSessionFact,
  readSessionTurnMessages,
  waitForSessionExecutionEventTree,
  workspaceRoot,
} from "../helpers/persistence-audit.js";
import {
  auditModelPrefixStability,
  isMainAgentModelInvocation,
} from "../helpers/model-message-assertions.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";
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

function isSummaryPolicyMessage(message = {}) {
  if (message.role === "tool" && toolResultName(message) === "task_summary") return false;
  if (message.role === "assistant" && Array.isArray(message.tool_calls) &&
      message.tool_calls.some((call) => toolCallName(call) === "task_summary")) return false;
  return message.role === "tool" ||
    (message.role === "assistant" && Array.isArray(message.tool_calls) && message.tool_calls.length > 0);
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
  expect(send.preferences.frontendThresholdsEnabled).toBe(true);
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
  const receipts = Array.isArray(checkpoint.receipts) ? checkpoint.receipts : [];
  expect(receipts.length).toBeGreaterThanOrEqual(1);
  expect(checkpoint?.checkpointRevision).toBe(receipts.length);
  const summarizedIds = new Set(receipts.flatMap((receipt) => receipt.summarizedMessageUids || []));
  expect(summarizedIds.size).toBeGreaterThan(0);

  const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  const messagesByUid = new Map(messages.map((message) => [message.messageUid, message]));
  for (const messageUid of summarizedIds) expect(messagesByUid.get(messageUid)?.summarized, messageUid).toBe(true);
  assertSummarizedToolPairsAreClosed(messages, summarizedIds);
  const firstTurnPolicyMessages = messages
    .filter((message) => message.turnScopeId === send.identity.turnScopeId)
    .filter(isSummaryPolicyMessage);
  expect(firstTurnPolicyMessages.length).toBeGreaterThan(0);
  for (const message of firstTurnPolicyMessages) {
    expect(message.summarized, `first-turn:${message.messageUid}`).toBe(true);
  }
  const phasePrompts = messages.filter((message) =>
    resolveContextInternalMessageType(message) === "noobot.phase_summary_prompt",
  );
  expect(phasePrompts.length).toBeGreaterThan(0);
  for (const phasePrompt of phasePrompts) {
    expect(phasePrompt).toMatchObject({ role: "user", type: "context_control", summarized: true });
    expect(summarizedIds.has(phasePrompt.messageUid)).toBe(true);
  }

  const taskSummaryCalls = messages.flatMap((message) =>
    (Array.isArray(message.tool_calls) ? message.tool_calls : [])
      .filter((call) => toolCallName(call) === "task_summary")
      .map((call) => ({ message, call })),
  );
  const taskSummaryResults = messages.filter((message) => toolResultName(message) === "task_summary");
  expect(taskSummaryCalls.length).toBe(phasePrompts.length);
  expect(taskSummaryResults.length).toBe(taskSummaryCalls.length);
  const summaryExchanges = taskSummaryCalls.map(({ call }) => {
    const fullSummaryContent = String(toolCallArgs(call).summaryContent || "");
    const parsedSummary = parseTaskSummaryContent(fullSummaryContent);
    const resultMessage = taskSummaryResults.find((message) =>
      String(message.tool_call_id || "").trim() === toolCallId(call),
    );
    expect(resultMessage).toBeTruthy();
    const result = JSON.parse(resultMessage.content);
    expect(result.protocolVersion).toBe(1);
    expect(result.summary).toEqual(createTaskSummaryReceipt(parsedSummary));
    expect(Object.keys(result.summary).sort()).toEqual([
      "abstract",
      "contentHash",
      "nextAction",
      "state",
    ]);
    expect(result.message).toContain("小结回执是后续流程的权威阶段状态");
    expect(result.message).toContain("已完成事项不得重新执行");
    expect(result.message).toContain("summary.nextAction");
    expect(resultMessage.content.includes(fullSummaryContent)).toBe(false);
    expect(result.summary.details).toBeUndefined();
    const attachmentRefs = (resultMessage.transferEnvelopes || [])
      .flatMap((envelope) => envelope?.payload?.attachments || [])
      .filter((attachment) => (attachment?.descriptor?.name || attachment?.name)
        === "task-summary-content.tool-input.md");
    expect(attachmentRefs.length).toBeGreaterThan(0);
    expect(new Set(attachmentRefs.map((attachment) =>
      attachment?.identity?.attachmentId,
    )).size).toBe(1);
    return {
      fullSummaryContent,
      resultMessage,
      summaryAttachmentId: attachmentRefs[0]?.identity?.attachmentId,
    };
  });

  await expect.poll(
    () => readAttachmentIndex(noobot.userId, noobot.sessionId, "model"),
    { timeout: 30000 },
  ).toMatchObject({ sessionId: noobot.sessionId, attachmentSource: "model" });
  const modelAttachmentIndex = await readAttachmentIndex(noobot.userId, noobot.sessionId, "model");
  const modelAttachments = Object.values(modelAttachmentIndex.attachments || {});
  for (const exchange of summaryExchanges) {
    const persistedSummaryAttachments = modelAttachments.filter((item) =>
      item.identity?.attachmentId === exchange.summaryAttachmentId
        && item.identity?.attachmentSource === "model"
        && item.descriptor?.name === "task-summary-content.tool-input.md"
        && item.descriptor?.generatedByModel === true
        && item.descriptor?.generationSource === "semantic_transfer_tool_input",
    );
    expect(persistedSummaryAttachments).toHaveLength(1);
    expect(await fs.readFile(path.join(
      workspaceRoot(),
      noobot.userId,
      persistedSummaryAttachments[0].storageRef.ref,
    ), "utf8")).toBe(exchange.fullSummaryContent);
  }

  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  const refreshedModelAttachmentIndex = await readAttachmentIndex(
    noobot.userId,
    noobot.sessionId,
    "model",
  );
  for (const exchange of summaryExchanges) {
    expect(Object.values(refreshedModelAttachmentIndex.attachments || {}).some((item) =>
      item.identity?.attachmentId === exchange.summaryAttachmentId
        && item.descriptor?.name === "task-summary-content.tool-input.md",
    )).toBe(true);
  }

  const mainInvocations = modelInvocationTraces(scoped).filter(isMainAgentModelInvocation);
  const mainPrefixAudit = auditModelPrefixStability(mainInvocations);
  expect(mainPrefixAudit.violations).toEqual([]);
  expect(mainPrefixAudit.stableComparisonCount).toBeGreaterThan(0);
  const observedCheckpointRevisions = new Set(mainInvocations.map((invocation) =>
    invocation.data.context.summaryCheckpointRevision,
  ));
  expect([...observedCheckpointRevisions].sort((left, right) => left - right)).toEqual(
    Array.from({ length: receipts.length + 1 }, (_, revision) => revision),
  );
  expect(mainPrefixAudit.checkpointRewriteCount).toBeLessThanOrEqual(receipts.length);
  for (const phasePrompt of phasePrompts) {
    expect(mainInvocations.some((invocation) =>
      invocation.data.messages.preview.some((message) => message.messageId === phasePrompt.messageUid),
    )).toBe(true);
  }
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
  for (const { resultMessage } of summaryExchanges) {
    const resultHash = messageContentHash(resultMessage.content);
    const invocationsReceivingReceipt = mainInvocations.filter((invocation) =>
      invocation.data.messages.preview.some((message) =>
        message.messageId === resultMessage.messageUid && message.contentHash === resultHash,
      ),
    );
    expect(invocationsReceivingReceipt.length).toBeGreaterThan(0);
  }
  const toolResultNames = messages.map(toolResultName).filter(Boolean);
  expect(toolResultNames.filter((name) => name === "execute_script").length).toBeGreaterThanOrEqual(2);
  expect(toolResultNames.filter((name) => name === "task_summary")).toHaveLength(summaryExchanges.length);

  // The next user turn must receive the durable post-finalization projection,
  // not the in-memory pre-finalizer tool-message prefix.
  const commandCountBeforeSecondTurn = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, uniquePrompt(testInfo, "第二轮只回复已完成，不调用工具。"));
  const secondSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    commandCountBeforeSecondTurn,
  );
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: secondSend.identity.turnScopeId,
    timeoutMs: 220000,
  });
  const secondTurnRecords = await waitForSessionExecutionEventTree(noobot.userId, noobot.sessionId, (items) => {
    const scopedSecondTurn = items.filter((item) => item.turnScopeId === secondSend.identity.turnScopeId);
    return modelInvocationTraces(scopedSecondTurn).some(isMainAgentModelInvocation);
  });
  const secondInvocations = modelInvocationTraces(
    secondTurnRecords.filter((item) => item.turnScopeId === secondSend.identity.turnScopeId),
  ).filter(isMainAgentModelInvocation);
  expect(secondInvocations.length).toBeGreaterThan(0);
  const firstTurnPolicyIds = new Set(firstTurnPolicyMessages.map((message) => message.messageUid));
  for (const invocation of secondInvocations) {
    expect(invocation.data.messages.summarizedCount).toBe(0);
    const visibleIds = new Set(invocation.data.messages.preview.map((message) => message.messageId).filter(Boolean));
    for (const messageUid of firstTurnPolicyIds) {
      expect(visibleIds.has(messageUid), `second-turn:${messageUid}`).toBe(false);
    }
  }
});
