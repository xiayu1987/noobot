/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { sendMessage, stopActiveTurn } from "../helpers/browser-actions.js";
import {
  commandsForSession,
  waitForCommand,
  waitForTurnTerminal,
} from "../helpers/scenario-assertions.js";
import { sendAndStop, uniquePrompt } from "../helpers/turn-scenarios.js";

async function openLatestExecutionReport(page) {
  const shell = page.locator(".thinking-realtime-shell").last();
  await expect(shell).toBeVisible({ timeout: 60000 });
  await expect(shell).not.toHaveClass(/\bis-running\b/, { timeout: 60000 });
  const header = shell.locator(".el-collapse-item__header");
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  const button = shell.locator(".execution-report-action-button");
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  const responsePromise = page.waitForResponse((response) =>
    response.url().includes("execution-report"),
  );
  await button.click();
  const response = await responsePromise;
  const url = new URL(response.url());
  return {
    status: response.status(),
    body: await response.text(),
    dialogProcessId: url.searchParams.get("dialogProcessId"),
  };
}

test("@core PBE-053 停止后的执行报告使用权威 dialogProcessId", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  const { send } = await sendAndStop({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    prompt: uniquePrompt(testInfo, "execution report after stop"),
  });

  const live = await openLatestExecutionReport(noobot.page);
  expect(live.dialogProcessId).toBe(send.identity.dialogProcessId);
  expect(live.status, live.body).toBe(200);

  await noobot.page.reload();
  const restored = await openLatestExecutionReport(noobot.page);
  expect(restored.dialogProcessId).toBe(send.identity.dialogProcessId);
  expect(restored.status, restored.body).toBe(200);
});

test("@core PBE-054 首个事件前停止的执行报告不发出空 dialogProcessId", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  const before = commandsForSession(protocolCapture, noobot.sessionId).length;
  await sendMessage(noobot.page, uniquePrompt(testInfo, "stop before first event"));
  await stopActiveTurn(noobot.page);
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send", before);
  await waitForTurnTerminal(protocolCapture, noobot.sessionId, send.identity.turnScopeId);

  const report = await openLatestExecutionReport(noobot.page);
  expect(report.dialogProcessId).toMatch(/^[A-Za-z0-9_-]{1,128}$/);
  expect(report.status, report.body).toBe(200);
});
