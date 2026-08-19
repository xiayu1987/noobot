/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect, installE2eModelPreferences } from "../fixtures/noobot.fixture.js";
import { connectThroughUi, readE2eCredentials } from "../fixtures/auth.fixture.js";
import { editLatestUserMessage } from "../helpers/browser-actions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";
import { commandsForSession, waitForCommand } from "../helpers/scenario-assertions.js";

test("@full PBE-023 Session version 冲突", async ({
  noobot,
  protocolCapture,
  browser,
}, testInfo) => {
  await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "version conflict baseline"),
  });
  const staleContext = await browser.newContext();
  await installE2eModelPreferences(staleContext);
  const stalePage = await staleContext.newPage();
  protocolCapture.bindPage(stalePage);
  try {
    await stalePage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
    await connectThroughUi(stalePage, readE2eCredentials());
    await expect(stalePage.locator(".monotonic-chip-btn.is-primary").last()).toBeVisible();
    const replacementResponses = [];
    for (const page of [noobot.page, stalePage]) {
      page.on("response", (response) => {
        if (/replace-turn/i.test(response.url())) {
          replacementResponses.push({ page, status: response.status() });
        }
      });
    }
    await Promise.all([
      editLatestUserMessage(noobot.page, uniquePrompt(testInfo, "first concurrent replacement")),
      editLatestUserMessage(stalePage, uniquePrompt(testInfo, "second concurrent replacement")),
    ]);
    await expect
      .poll(() => replacementResponses.map(({ status }) => status).sort())
      .toEqual([200, 409]);
    await waitForCommand(protocolCapture, noobot.sessionId, "turn.resend");
    const successfulPage = replacementResponses.find(({ status }) => status === 200)?.page;
    const stopButton = successfulPage?.locator(".stop-float-btn");
    if (stopButton && (await stopButton.isVisible())) {
      await stopButton.click();
      await expect(stopButton).toBeHidden();
    }
    const resends = commandsForSession(protocolCapture, noobot.sessionId).filter(
      (item) => item.commandType === "turn.resend",
    );
    expect(resends).toHaveLength(1);
  } finally {
    await staleContext.close();
  }
});

test("@full PBE-024 停止命令幂等性", async ({ noobot, protocolCapture }, testInfo) => {
  const { sendMessage } = await import("../helpers/browser-actions.js");
  await sendMessage(noobot.page, uniquePrompt(testInfo, "long run for concurrent stop"));
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await expect(noobot.page.locator(".stop-float-btn")).toBeVisible();
  const secondPage = await noobot.page.context().newPage();
  await secondPage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
  await connectThroughUi(secondPage, readE2eCredentials());
  await expect(secondPage.locator(".stop-float-btn")).toBeVisible();
  await Promise.all([
    noobot.page.locator(".stop-float-btn").evaluate((button) => button.click()),
    secondPage.locator(".stop-float-btn").evaluate((button) => button.click()),
  ]);
  const { waitForLifecycle } = await import("../helpers/scenario-assertions.js");
  await waitForLifecycle(
    protocolCapture,
    noobot.sessionId,
    "turn.stop_completed",
    0,
    send.identity.turnScopeId,
  );
  const terminals = (await import("../helpers/scenario-assertions.js"))
    .lifecycleForSession(protocolCapture, noobot.sessionId)
    .filter(
      (event) =>
        event.turnScopeId === send.identity.turnScopeId &&
        event.eventType === "turn.stop_completed",
    );
  expect(new Set(terminals.map((event) => event.eventId)).size).toBe(1);
});
