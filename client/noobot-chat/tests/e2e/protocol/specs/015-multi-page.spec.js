/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { connectThroughUi, readE2eCredentials } from "../fixtures/auth.fixture.js";
import { sendMessage, stopActiveTurn } from "../helpers/browser-actions.js";
import { waitForCommand, waitForLifecycle } from "../helpers/scenario-assertions.js";
import { uniquePrompt } from "../helpers/turn-scenarios.js";

test("@full PBE-015 双标签页生命周期一致性", async ({ noobot, protocolCapture, browser }, testInfo) => {
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  protocolCapture.bindPage(secondPage);
  try {
    await secondPage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
    await connectThroughUi(secondPage, readE2eCredentials());
    await sendMessage(noobot.page, uniquePrompt(testInfo, "multi-page long run"));
    const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
    await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.processing_started", 0, send.identity.turnScopeId);
    await expect(secondPage.locator(".stop-float-btn")).toBeVisible();
    await stopActiveTurn(secondPage);
    await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.stop_completed", 0, send.identity.turnScopeId);
    await expect(noobot.page.locator(".stop-float-btn")).toBeHidden();
  } finally {
    await secondContext.close();
  }
});
