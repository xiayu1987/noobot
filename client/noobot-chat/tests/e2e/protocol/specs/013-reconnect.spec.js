/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, stopActiveTurn, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { beginReload, reloadAndWaitForReconnect, waitForReconnect } from "../helpers/reconnect-scenarios.js";
import { waitForSessionExecutionEventTree } from "../helpers/persistence-audit.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-013 运行中刷新后执行记录可展开并收敛到终态", async ({ noobot, protocolCapture }, testInfo) => {
  await sendMessage(noobot.page, uniquePrompt(testInfo, [
    "Call execute_script exactly once with command `sleep 20`, foreground mode and low risk.",
    "After that tool returns, reply with exactly CASE013-OK. Do not call any other tool.",
  ].join(" ")));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  await waitForSessionExecutionEventTree(noobot.userId, noobot.sessionId, (records) => records.some((record) =>
    record.turnScopeId === send.identity.turnScopeId
      && record.event === "tool_call_start"
      && record.data?.tool === "execute_script",
  ));
  const liveShell = noobot.page.locator(".thinking-realtime-shell").last();
  await expect(liveShell).toBeVisible();
  await expect(liveShell.locator(".thinking-detail-action-button")).toHaveText(/Thinking Details \([1-9]\d*\)/);
  const liveToolLine = liveShell.locator(".base-thinking-log-line.is-tool").first();
  await liveToolLine.locator(".base-thinking-log-line__text").click();
  await expect(liveToolLine.locator(".base-thinking-log-line__detail")).not.toBeEmpty();
  await liveToolLine.locator(".base-thinking-log-line__text").click();
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  const thinkingShell = noobot.page.locator(".thinking-realtime-shell").last();
  await expect(thinkingShell).toBeVisible();
  const thinkingHeader = thinkingShell.locator(".el-collapse-item__header");
  if (await thinkingHeader.getAttribute("aria-expanded") !== "true") {
    await thinkingHeader.click();
  }
  await expect(thinkingHeader).toHaveAttribute("aria-expanded", "true");
  await thinkingShell.locator(".thinking-detail-action-button").click();
  const detailsDrawer = noobot.page.locator(".el-drawer").filter({ has: noobot.page.locator(".thinking-details-panel") }).last();
  await expect(detailsDrawer.locator(".thinking-details-panel")).toBeVisible();
  await expect(thinkingShell.locator(".thinking-detail-action-button")).toHaveText(/Thinking Details \([1-9]\d*\)/);
  const runningToolLine = detailsDrawer.locator(".base-thinking-log-line.is-tool").first();
  await expect(runningToolLine).toBeVisible();
  await runningToolLine.locator(".base-thinking-log-line__text").click();
  await expect(detailsDrawer.locator(".thinking-details-panel .base-thinking-log-line__detail")).toHaveCount(1);
  await runningToolLine.locator(".base-thinking-log-line__text").click();
  await expect(detailsDrawer.locator(".thinking-details-panel .base-thinking-log-line__detail")).toHaveCount(0);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
    timeoutMs: 120000,
  });
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.completed", 0, send.identity.turnScopeId);
  await expect(thinkingShell).not.toHaveClass(/is-running/);
  await expect(thinkingShell.locator(".thinking-detail-action-button")).toContainText("2");
  await noobot.page.keyboard.press("Escape");
  await expect(detailsDrawer.locator(".thinking-details-panel")).toBeHidden();
  if (await thinkingHeader.getAttribute("aria-expanded") !== "true") {
    await thinkingHeader.click();
  }
  await thinkingShell.locator(".thinking-detail-action-button").click();
  await expect(detailsDrawer.locator(".thinking-details-panel")).toBeVisible();
  const completedToolLines = detailsDrawer.locator(".base-thinking-log-line.is-tool");
  await expect(completedToolLines).toHaveCount(2);
  for (const line of await completedToolLines.all()) {
    const trigger = line.locator(".base-thinking-log-line__text");
    await trigger.click();
    await expect(line.locator(".base-thinking-log-line__detail")).not.toBeEmpty();
  }
  expect(protocolCapture.websockets.length).toBeGreaterThanOrEqual(2);
});

test("@core PBE-014 reconnect 与新 Continue 并发", async ({ noobot, protocolCapture }, testInfo) => {
  await sendMessage(noobot.page, uniquePrompt(testInfo, "long run then stop"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.stop_completed", 0, send.identity.turnScopeId);
  const receivedAtStart = protocolCapture.websocketReceived.length;
  await beginReload(noobot.page);
  await noobot.page.locator(".chat-input textarea").fill(uniquePrompt(testInfo, "continue during reconnect"));
  const continueButton = noobot.page.locator(".send-btn");
  await expect(continueButton).toBeDisabled();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await waitForReconnect(protocolCapture, receivedAtStart);
  const continued = await waitForCommand(protocolCapture, noobot.sessionId, "turn.continue");
  expect(continued.continuation.turnScopeId).toBe(send.identity.turnScopeId);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.processing_started",
    0,
    continued.identity.turnScopeId,
  );
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    continued.identity.turnScopeId,
  );
});
