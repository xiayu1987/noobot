/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, stopActiveTurn } from "../helpers/browser-actions.js";
import { beginReload, reloadAndWaitForReconnect, waitForReconnect } from "../helpers/reconnect-scenarios.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-013 活动轮次刷新页面 reconnect", async ({ noobot, protocolCapture }, testInfo) => {
  await sendMessage(noobot.page, uniquePrompt(testInfo, "long run across reload"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  await stopActiveTurn(noobot.page);
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.stop_completed", 0, send.identity.turnScopeId);
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
