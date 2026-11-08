/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { decodeExecutionReport } from "@noobot/session-protocol/execution-report";
import {
  sendMessage,
  stopActiveTurn,
  waitForNaturalCompletion,
} from "../helpers/browser-actions.js";
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
  const body = await response.text();
  expect(response.status(), body).toBe(200);
  const report = decodeExecutionReport(JSON.parse(body).report);
  const measurements = report.summary.metrics.model.measurements;
  expect(measurements.state).toBe("collected");
  const usage = page.locator('[data-testid="execution-report-usage"]');
  await expect(usage).toBeVisible();
  const tokens = measurements.usage.tokens;
  const total =
    tokens.sampleCount > 0 ? String(tokens.inputTokensSum + tokens.outputTokensSum) : "—";
  const tokenLabel = usage.locator("dt").filter({ hasText: /总 token 消耗|Total Token Usage/ });
  await expect(tokenLabel.locator("xpath=following-sibling::dd[1]")).toHaveText(total);
  await expect(
    usage.locator("dt").filter({ hasText: /缓存命中请求率|Cache Hit Request Rate/ }),
  ).toBeVisible();
  const details = usage.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  await expect(details).toHaveAttribute("open", "");
  await expect(
    usage.locator("dt").filter({ hasText: /平均每次请求 token 消耗|Average Tokens per Request/ }),
  ).toBeVisible();
  await expect(
    usage
      .locator("dt")
      .filter({ hasText: /请求体公共前缀字节占比|Request Body Common Prefix Byte Share/ }),
  ).toBeVisible();
  return {
    status: response.status(),
    body,
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

test("@core PBE-057 completed model usage persists and renders after reload", async ({
  noobot,
  protocolCapture,
}, testInfo) => {
  await sendMessage(
    noobot.page,
    uniquePrompt(testInfo, "Do not call any tool. Reply with exactly: USAGE-OK"),
  );
  const send = await waitForCommand(protocolCapture, noobot.sessionId, "turn.send");
  await waitForNaturalCompletion({
    page: noobot.page,
    capture: protocolCapture,
    sessionId: noobot.sessionId,
    turnScopeId: send.identity.turnScopeId,
  });
  const live = await openLatestExecutionReport(noobot.page);
  const report = decodeExecutionReport(JSON.parse(live.body).report);
  expect(report.status).toBe("completed");
  const measurements = report.summary.metrics.model.measurements;
  expect(measurements.requests.startedCount).toBeGreaterThan(0);
  expect(measurements.requests.unfinishedCount).toBe(0);
  expect(measurements.usage.tokens.sampleCount).toBeGreaterThan(0);
  expect(measurements.usage.tokens.inputTokensSum).toBeGreaterThan(0);
  expect(measurements.usage.tokens.outputTokensSum).toBeGreaterThan(0);
  await noobot.page.reload();
  const restored = await openLatestExecutionReport(noobot.page);
  expect(decodeExecutionReport(JSON.parse(restored.body).report)).toEqual(report);
});
