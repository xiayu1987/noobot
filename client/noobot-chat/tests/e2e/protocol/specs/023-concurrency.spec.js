/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect, installE2eModelPreferences } from "../fixtures/noobot.fixture.js";
import { connectThroughUi, readE2eCredentials } from "../fixtures/auth.fixture.js";
import { editLatestUserMessage, stopActiveTurn } from "../helpers/browser-actions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";
import {
  commandsForSession,
  waitForCommand,
  waitForLifecycle,
} from "../helpers/scenario-assertions.js";
import { waitForModelInvocationTraces } from "../helpers/persistence-audit.js";
import { waitForReconnect } from "../helpers/reconnect-scenarios.js";

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
    await expect(stalePage.locator(".monotonic-action-bar button.is-primary").last()).toBeVisible();
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
    const resend = await waitForCommand(protocolCapture, noobot.sessionId, "turn.resend");
    await waitForLifecycle(
      protocolCapture,
      noobot.sessionId,
      "turn.processing_started",
      0,
      resend.identity.turnScopeId,
    );
    await waitForModelInvocationTraces(noobot.userId, noobot.sessionId, (records) =>
      records.some((record) => record.turnScopeId === resend.identity.turnScopeId),
    );
    const successfulPage = replacementResponses.find(({ status }) => status === 200).page;
    await stopActiveTurn(successfulPage);
    await waitForLifecycle(
      protocolCapture,
      noobot.sessionId,
      "turn.stop_completed",
      0,
      resend.identity.turnScopeId,
    );
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
  await sendMessage(
    noobot.page,
    uniquePrompt(testInfo, "调用 execute_script 执行 sleep 30，等待实际结果后回复 DONE。"),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await expect(noobot.page.locator(".stop-float-btn")).toBeVisible();
  const secondPage = await noobot.page.context().newPage();
  const receivedAtStart = protocolCapture.websocketReceived.length;
  await secondPage.goto(`/?session=${encodeURIComponent(noobot.sessionId)}`);
  await waitForReconnect(protocolCapture, receivedAtStart);
  await expect(secondPage.locator(".session-item.active")).toHaveAttribute(
    "data-session-id",
    noobot.sessionId,
  );
  await expect(secondPage.locator(".stop-float-btn")).toBeVisible();
  await waitForModelInvocationTraces(noobot.userId, noobot.sessionId, (records) =>
    records.some((record) => record.turnScopeId === send.identity.turnScopeId),
  );
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
