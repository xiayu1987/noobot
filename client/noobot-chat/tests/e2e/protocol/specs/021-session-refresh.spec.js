/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { fixedAttachment, sendMessage, waitForNaturalCompletion } from "../helpers/browser-actions.js";
import { reloadAndWaitForReconnect } from "../helpers/reconnect-scenarios.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";
import { sendAndStop, continueAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

test("@core PBE-021 自然完成后刷新 Session 并继续发送", async ({ noobot, protocolCapture }, testInfo) => {
  await sendMessage(noobot.page, uniquePrompt(testInfo, "complete naturally"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId, turnScopeId: send.identity.turnScopeId });
  const count = commandsForSession(protocolCapture, noobot.sessionId).filter((item) => item.commandType === "turn.send").length;
  await reloadAndWaitForReconnect(noobot.page, protocolCapture);
  expect(commandsForSession(protocolCapture, noobot.sessionId).filter((item) => item.commandType === "turn.send")).toHaveLength(count);
  await expect(noobot.page.locator(".stop-float-btn")).toBeHidden();

  await sendMessage(noobot.page, uniquePrompt(testInfo, "send after refresh without an aggregate version conflict"));
  const secondSend = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", count);
  expect(secondSend.concurrency.expectedAggregateVersion)
    .toBeGreaterThan(send.concurrency.expectedAggregateVersion);
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: secondSend.identity.turnScopeId,
  });
});

test("@core PBE-022 停止后关闭浏览器再打开并继续", async ({ noobot, protocolCapture }, testInfo) => {
  const file = fixedAttachment("pbe-022.txt");
  const { send } = await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "stop before browser restart"), attachment: file });
  await noobot.page.close();
  const page = await noobot.page.context().newPage();
  await page.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
  const { connectThroughUi, readE2eCredentials } = await import("../fixtures/auth.fixture.js");
  await connectThroughUi(page, readE2eCredentials());
  const continued = await continueAndStop({ page, capture: protocolCapture, sessionId: noobot.sessionId,
    previous: send, prompt: uniquePrompt(testInfo, "continue after browser restart") });
  expect(continued.input.attachments).toEqual([]);
});
