/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  resolveContextToolCallDeclarationId,
  resolveContextToolResultCallId,
} from "@noobot/context-protocol/message/codec";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import { resolveSessionMessageRecordInternalMessageType } from "@noobot/session-protocol";
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
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

function assertClosedSummaryPairs(messages, summarizedIds) {
  const summarized = messages.filter((message) => summarizedIds.has(message.messageUid));
  const calls = new Set(
    summarized.flatMap((message) =>
      (message.tool_calls || []).map(resolveContextToolCallDeclarationId),
    ),
  );
  const results = new Set(
    summarized.filter((message) => message.role === "tool").map(resolveContextToolResultCallId),
  );
  expect(results).toEqual(calls);
}

function assertCheckpointProjection(invocations, receipts) {
  for (const receipt of receipts) {
    const after = invocations.filter(
      (record) => record.data.context.summaryCheckpointRevision >= receipt.checkpointRevision,
    );
    expect(after.length, receipt.checkpointId).toBeGreaterThan(0);
    for (const invocation of after) {
      expect(invocation.data.messages.summarizedCount).toBe(0);
      const visible = new Set(
        invocation.data.messages.preview.map((message) => message.messageUid),
      );
      for (const uid of receipt.summarizedMessageUids)
        expect(visible.has(uid), `${receipt.checkpointId}:${uid}`).toBe(false);
    }
  }
}

test("@full PBE-034 独立流式小结、checkpoint 与跨轮模型输入闭环", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(900000);
  await selectPlugins(noobot.page, []);
  await setMainSummaryTurnsThreshold(noobot.page, 2);
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      [
        "使用容器已安装的 Node.js（node -e）完成三步只读计算链。",
        "先调用 execute_script 生成一个随机十六进制 marker；拿到实际 marker 后，再调用 execute_script 计算该 marker 的 SHA-256。",
        "最后调用 execute_script 从实际 SHA-256 中提取前八位。每一步必须使用前一步的实际输出，不得并行执行，最后汇总三个结果。",
      ].join(" "),
    ),
  );
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
  const records = await waitForSessionExecutionEventTree(noobot.userId, noobot.sessionId, (items) =>
    items.some(
      (item) =>
        item.turnScopeId === send.identity.turnScopeId && item.event === "phase_summary_completed",
    ),
  );
  const scoped = records.filter((item) => item.turnScopeId === send.identity.turnScopeId);
  expect(scoped.find((item) => item.event === "phase_summary_required").data).toMatchObject({
    loopThreshold: 2,
    trigger: "loop_turns",
  });
  const traces = modelInvocationTraces(scoped);
  const summaries = traces.filter((record) => record.data.invocation.purpose === "phase_summary");
  expect(summaries.length).toBeGreaterThan(0);
  for (const summary of summaries) {
    expect(summary.data.model).toMatchObject({ streaming: true, boundToolCount: 0 });
    expect(summary.data.invocation.contextSequencePolicy).toBe("independent_request");
  }
  const session = await readSessionFact(noobot.userId, noobot.sessionId);
  const checkpoint = session.turnSummaryCheckpoints[send.identity.turnScopeId];
  const receipts = checkpoint.receipts;
  expect(receipts.length).toBeGreaterThan(0);
  expect(checkpoint.checkpointRevision).toBe(receipts.length);
  const summarizedIds = new Set(receipts.flatMap((receipt) => receipt.summarizedMessageUids));
  const messages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  for (const uid of summarizedIds)
    expect(messages.find((message) => message.messageUid === uid)?.summarized, uid).toBe(true);
  assertClosedSummaryPairs(messages, summarizedIds);
  const results = messages.filter(
    (message) =>
      resolveSessionMessageRecordInternalMessageType(message) ===
      CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
  );
  expect(results).toHaveLength(receipts.length);
  for (const result of results) {
    expect(result).toMatchObject({
      role: "user",
      type: "message",
      injectedMessage: true,
      injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.PHASE_SUMMARY_RESULT,
    });
    expect(result.content.trim().length).toBeGreaterThan(0);
  }
  const lastResult = results.at(-1);
  expect(summarizedIds.has(lastResult.messageUid)).toBe(false);
  expect(
    messages
      .flatMap((message) => message.tool_calls || [])
      .some((call) => (call.name || call.function?.name) === "task_summary"),
  ).toBe(false);
  const primary = traces
    .filter(isMainAgentModelInvocation)
    .filter((record) => record.data.invocation.purpose !== "phase_summary");
  expect(auditModelPrefixStability(primary).violations).toEqual([]);
  assertCheckpointProjection(primary, receipts);
  expect(
    primary.some((record) =>
      record.data.messages.preview.some((message) => message.messageUid === lastResult.messageUid),
    ),
  ).toBe(true);

  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  const refreshed = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  expect(refreshed.find((message) => message.messageUid === lastResult.messageUid)?.content).toBe(
    lastResult.content,
  );
  const before = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, uniquePrompt(testInfo, "第二轮只回复已完成，不调用工具。"));
  const second = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", before);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: second.identity.turnScopeId,
    timeoutMs: 220000,
  });
  const secondRecords = await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (items) =>
      modelInvocationTraces(
        items.filter((item) => item.turnScopeId === second.identity.turnScopeId),
      ).some(isMainAgentModelInvocation),
  );
  const secondTraces = modelInvocationTraces(
    secondRecords.filter((item) => item.turnScopeId === second.identity.turnScopeId),
  ).filter(isMainAgentModelInvocation);
  for (const record of secondTraces) {
    const visible = new Set(record.data.messages.preview.map((message) => message.messageUid));
    for (const uid of summarizedIds) expect(visible.has(uid), uid).toBe(false);
  }
  expect(
    secondTraces.some((record) =>
      record.data.messages.preview.some((message) => message.messageUid === lastResult.messageUid),
    ),
  ).toBe(true);
});
