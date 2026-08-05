/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { connectThroughUi, readE2eCredentials } from "../fixtures/auth.fixture.js";
import { editLatestUserMessage } from "../helpers/browser-actions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";

test("@full PBE-023 Session version 冲突", async ({ noobot, protocolCapture, browser }, testInfo) => {
  await sendAndStop({ page: noobot.page, capture: protocolCapture, sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "version conflict baseline") });
  const staleContext = await browser.newContext();
  const stalePage = await staleContext.newPage();
  protocolCapture.bindPage(stalePage);
  try {
    await stalePage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
    await connectThroughUi(stalePage, readE2eCredentials());
    await expect(stalePage.locator(".monotonic-chip-btn.is-primary").last()).toBeVisible();
    await staleContext.setOffline(true);
    await editLatestUserMessage(noobot.page, uniquePrompt(testInfo, "authoritative replacement"));
    await waitForCommand(protocolCapture, noobot.sessionId, "turn.resend");
    await noobot.page.locator(".stop-float-btn").click();
    await expect(noobot.page.locator(".stop-float-btn")).toBeHidden();
    await staleContext.setOffline(false);
    const staleResponses = [];
    stalePage.on("response", (response) => {
      if (/replace-turn/i.test(response.url())) staleResponses.push(response.status());
    });
    await editLatestUserMessage(stalePage, uniquePrompt(testInfo, "stale replacement"));
    await expect.poll(() => staleResponses.at(-1) || 0).toBe(409);
    const resends = commandsForSession(protocolCapture, noobot.sessionId).filter((item) => item.commandType === "turn.resend");
    expect(resends).toHaveLength(1);
  } finally {
    await staleContext.close();
  }
});

test("@full PBE-024 停止命令幂等性", async ({ noobot, protocolCapture }, testInfo) => {
  const secondPage = await noobot.page.context().newPage();
  await secondPage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
  await connectThroughUi(secondPage, readE2eCredentials());
  const { sendMessage } = await import("../helpers/browser-actions.js");
  await sendMessage(noobot.page, uniquePrompt(testInfo, "long run for concurrent stop"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await expect(noobot.page.locator(".stop-float-btn")).toBeVisible();
  await expect(secondPage.locator(".stop-float-btn")).toBeVisible();
  await Promise.allSettled([
    noobot.page.locator(".stop-float-btn").click(),
    secondPage.locator(".stop-float-btn").click(),
  ]);
  const { waitForLifecycle } = await import("../helpers/scenario-assertions.js");
  await waitForLifecycle(protocolCapture, noobot.sessionId, "turn.stop_completed", 0, send.identity.turnScopeId);
  const terminals = (await import("../helpers/scenario-assertions.js")).lifecycleForSession(protocolCapture, noobot.sessionId)
    .filter((event) => event.turnScopeId === send.identity.turnScopeId && event.eventType === "turn.stop_completed");
  expect(terminals).toHaveLength(1);
});
