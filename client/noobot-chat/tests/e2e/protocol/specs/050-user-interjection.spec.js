/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import {
  sendMessage,
  selectPlugins,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import {
  modelInvocationTraces,
  readSessionExecutionEventTree,
  readSessionTurnMessages,
  readSnapshots,
  waitForSessionExecutionEventTree,
} from "../helpers/persistence-audit.js";
import {
  assertContinuation,
  commandsForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { isMainAgentModelInvocation } from "../helpers/model-message-assertions.js";
import { assertSerializedModelMessageSnapshot } from "../helpers/snapshot-assertions.js";
import { toolEventsForTurn } from "../helpers/thinking-tool-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";
import { findProtocolObjects, waitForCaptured } from "../helpers/websocket-capture.js";
import { PROTOCOL_TIMEOUTS } from "../helpers/protocol-timeouts.js";

const INTERJECTION_TYPE = "noobot.user_interjection";

function commandReceipts(capture) {
  return findProtocolObjects(capture.websocketReceived)
    .filter(({ event }) => event === "transport_command_receipt")
    .map(({ data }) => data);
}

function userInterjectionEvents(capture) {
  return findProtocolObjects(capture.websocketReceived)
    .filter(
      ({ event, data }) =>
        event === "message_event" && data?.payload?.eventType === "user_interjection",
    )
    .map(({ data }) => data);
}

async function waitForCompletedReceipt(capture, commandId) {
  return waitForCaptured(() =>
    commandReceipts(capture).find(
      (receipt) => receipt.commandId === commandId && receipt.outcome === "completed",
    ),
  );
}

async function waitForExecuteScriptStart(userId, sessionId, turnScopeId) {
  return waitForSessionExecutionEventTree(
    userId,
    sessionId,
    (records) =>
      toolEventsForTurn(records, turnScopeId).some(
        (record) => record.event === "tool_call_start" && record.data?.tool === "execute_script",
      ),
    { timeoutMs: PROTOCOL_TIMEOUTS.model },
  );
}

async function openLatestThinkingPanel(page) {
  const shell = page.locator(".thinking-realtime-shell").last();
  await expect(shell).toBeVisible({ timeout: 60000 });
  const header = shell.locator(".el-collapse-item__header");
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  return shell;
}

test("@core PBE-050 首轮可停止且用户插话按 FIFO 注入、持久化并刷新恢复", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  test.setTimeout(PROTOCOL_TIMEOUTS.model * 2 + PROTOCOL_TIMEOUTS.audit);
  await selectPlugins(noobot.page, []);

  const firstOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  const longCommand = `node -e "setTimeout(()=>console.log('PBE050-FIRST'),30000)"`;
  await sendMessage(
    noobot.page,
    uniquePrompt(
      testInfo,
      `Call execute_script once with this exact command and wait for it before replying: ${longCommand}`,
    ),
  );
  const firstSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    firstOffset,
  );
  const firstProcessing = await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    firstSend.identity.turnScopeId,
  );
  await waitForExecuteScriptStart(noobot.userId, noobot.sessionId, firstSend.identity.turnScopeId);
  await stopActiveTurn(noobot.page);
  const firstStop = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.stop",
    firstOffset,
  );
  expect(firstStop.identity).toMatchObject({
    sessionId: noobot.sessionId,
    turnScopeId: firstSend.identity.turnScopeId,
    dialogProcessId: firstProcessing.dialogProcessId,
  });
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    firstSend.identity.turnScopeId,
  );
  const stoppedSnapshots = await readSnapshots(noobot.userId, noobot.sessionId);
  expect(stoppedSnapshots).toHaveLength(1);
  assertSerializedModelMessageSnapshot(stoppedSnapshots[0]);

  const continuationOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  const shortCommand = `node -e "setTimeout(()=>console.log('PBE050-CONTINUE'),8000)"`;
  await sendMessage(
    noobot.page,
    `继续，并调用一次 execute_script 执行这个精确命令，等待工具返回后再回答：${shortCommand}`,
  );
  const continued = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.continue",
    continuationOffset,
  );
  assertContinuation(
    {
      ...firstSend,
      identity: { ...firstSend.identity, dialogProcessId: firstProcessing.dialogProcessId },
    },
    continued,
  );
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    continued.identity.turnScopeId,
  );
  await waitForExecuteScriptStart(noobot.userId, noobot.sessionId, continued.identity.turnScopeId);

  const firstText = "PBE050-INTERJECTION-FIRST";
  const firstInterjectionOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, firstText);
  const firstInterjection = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.interject",
    firstInterjectionOffset,
  );
  await waitForCompletedReceipt(protocolCapture, firstInterjection.commandId);
  let shell = await openLatestThinkingPanel(noobot.page);
  let latestInterjection = shell.locator('[data-thinking-block="user-interjection"]');
  await expect(latestInterjection).toContainText(firstText);

  const secondText = "PBE050-INTERJECTION-SECOND";
  const secondInterjectionOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, secondText);
  const secondInterjection = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.interject",
    secondInterjectionOffset,
  );
  await waitForCompletedReceipt(protocolCapture, secondInterjection.commandId);
  shell = await openLatestThinkingPanel(noobot.page);
  latestInterjection = shell.locator('[data-thinking-block="user-interjection"]');
  await expect(latestInterjection).toContainText(secondText);
  await expect(latestInterjection).not.toContainText(firstText);

  for (const command of [firstInterjection, secondInterjection]) {
    expect(command.identity).toMatchObject({
      sessionId: noobot.sessionId,
      turnScopeId: continued.identity.turnScopeId,
    });
    expect(command.identity.dialogProcessId).toBeTruthy();
  }
  expect(firstInterjection.identity).toEqual(secondInterjection.identity);
  const authorityInterjections = userInterjectionEvents(protocolCapture).filter((event) =>
    [firstInterjection.commandId, secondInterjection.commandId].includes(
      event.causality?.commandId,
    ),
  );
  expect(
    authorityInterjections.map((event) => [
      event.causality.commandId,
      event.payload.contentFact.contentId,
      event.payload.contentFact.sequence,
      event.payload.contentFact.text,
    ]),
  ).toEqual([
    [
      firstInterjection.commandId,
      `message:user-interjection:${firstInterjection.commandId}`,
      1,
      firstText,
    ],
    [
      secondInterjection.commandId,
      `message:user-interjection:${secondInterjection.commandId}`,
      2,
      secondText,
    ],
  ]);

  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: continued.identity.turnScopeId,
    timeoutMs: PROTOCOL_TIMEOUTS.model,
  });

  const persistedMessages = await readSessionTurnMessages(noobot.userId, noobot.sessionId);
  const persistedInterjections = persistedMessages.filter(
    (message) =>
      message.injectedMessageType === INTERJECTION_TYPE &&
      message.turnScopeId === continued.identity.turnScopeId,
  );
  expect(
    persistedInterjections.map((message) => [
      message.content,
      message.messageUid,
      message.interjectionSequence,
      message.ts,
    ]),
  ).toEqual(
    authorityInterjections.map((event) => [
      event.payload.contentFact.text,
      event.payload.contentFact.sourceMessageUid,
      event.payload.contentFact.sequence,
      event.payload.contentFact.timestamp,
    ]),
  );
  const secondPersistedInterjection = persistedInterjections.find(
    (message) => message.content === secondText,
  );
  const earlierPersistedInterjection = persistedInterjections.find(
    (message) => message.content === firstText,
  );
  expect(earlierPersistedInterjection).toMatchObject({
    injectedMessageType: INTERJECTION_TYPE,
    summarized: false,
  });
  expect(secondPersistedInterjection).toMatchObject({
    injectedMessageType: INTERJECTION_TYPE,
    summarized: false,
  });

  const executionRecords = await readSessionExecutionEventTree(noobot.userId, noobot.sessionId);
  const continuedTraces = modelInvocationTraces(executionRecords)
    .filter((record) => record.turnScopeId === continued.identity.turnScopeId)
    .sort(
      (left, right) =>
        Number(left.data?.invocationSequence || 0) - Number(right.data?.invocationSequence || 0),
    );
  const traceWithInterjections = continuedTraces.find((record) => {
    const preview = record.data?.messages?.preview || [];
    return [firstText, secondText].every((text) =>
      preview.some(
        (message) =>
          message.injectedMessageType === INTERJECTION_TYPE && message.contentPreview === text,
      ),
    );
  });
  expect(traceWithInterjections).toBeTruthy();
  const interjectionPreview = traceWithInterjections.data.messages.preview.filter(
    (message) => message.injectedMessageType === INTERJECTION_TYPE,
  );
  expect(interjectionPreview.map((message) => message.contentPreview).slice(-2)).toEqual([
    firstText,
    secondText,
  ]);

  shell = await openLatestThinkingPanel(noobot.page);
  latestInterjection = shell.locator('[data-thinking-block="user-interjection"]');
  await expect(latestInterjection).toContainText(secondText);
  await expect(latestInterjection).not.toContainText(firstText);
  await shell.locator(".thinking-detail-action-button").click();
  const details = noobot.page.locator(".thinking-details-panel");
  await expect(details).toBeVisible();
  await details.locator(".el-tabs__item").nth(1).click();
  const detailsText = await details.locator(".thinking-details-content-body").innerText();
  expect(detailsText.indexOf(firstText)).toBeGreaterThanOrEqual(0);
  expect(detailsText.indexOf(secondText)).toBeGreaterThan(detailsText.indexOf(firstText));
  const detailsDrawer = noobot.page.locator(".el-drawer").filter({ has: details });
  await detailsDrawer.locator(".el-drawer__close-btn").click();
  await expect(details).toBeHidden();

  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  shell = await openLatestThinkingPanel(noobot.page);
  await expect(shell.locator('[data-thinking-block="user-interjection"]')).toContainText(
    secondText,
  );

  const secondTurnOffset = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, uniquePrompt(testInfo, "第二轮只回复已完成，不调用工具。"));
  const secondSend = await waitForCommand(
    protocolCapture,
    noobot.sessionId,
    "turn.send",
    secondTurnOffset,
  );
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: secondSend.identity.turnScopeId,
    timeoutMs: PROTOCOL_TIMEOUTS.model,
  });
  const secondTurnRecords = await waitForSessionExecutionEventTree(
    noobot.userId,
    noobot.sessionId,
    (records) =>
      modelInvocationTraces(records).some(
        (record) =>
          record.turnScopeId === secondSend.identity.turnScopeId &&
          isMainAgentModelInvocation(record),
      ),
  );
  const secondTurnInvocations = modelInvocationTraces(secondTurnRecords).filter(
    (record) =>
      record.turnScopeId === secondSend.identity.turnScopeId && isMainAgentModelInvocation(record),
  );
  expect(secondTurnInvocations.length).toBeGreaterThan(0);
  expect(
    secondTurnInvocations.some((invocation) =>
      persistedInterjections.every((interjection) =>
        invocation.data.messages.preview.some(
          (message) =>
            message.messageId === interjection.messageUid &&
            message.injectedMessageType === INTERJECTION_TYPE &&
            message.contentPreview === interjection.content,
        ),
      ),
    ),
  ).toBe(true);
});
