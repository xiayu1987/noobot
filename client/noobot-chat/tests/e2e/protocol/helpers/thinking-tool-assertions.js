/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { waitForSessionExecutionEventTree } from "./persistence-audit.js";

const text = (value) => String(value ?? "").trim();

async function readExpandedToolLine(line) {
  const trigger = line.locator(".base-thinking-log-line__text");
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const detail = line.locator(".base-thinking-log-line__detail");
  await expect(detail).not.toBeEmpty();
  const projection = {
    event: text(await line.locator(".base-thinking-log-line__event").textContent()),
    summary: text(await trigger.textContent()),
    expandable: true,
    detail: text(await detail.textContent()),
  };
  await trigger.click();
  await expect(detail).toBeHidden();
  return projection;
}

export function toolEventsForTurn(records = [], turnScopeId = "") {
  return records.filter(
    (record = {}) =>
      record.turnScopeId === turnScopeId &&
      ["tool_call_start", "tool_call_end"].includes(record.event),
  );
}

export function assertCanonicalToolPairs(events = [], expectedToolNames = []) {
  const calls = events.filter((event) => event.event === "tool_call_start");
  const results = events.filter((event) => event.event === "tool_call_end");
  expect(calls.map((event) => text(event.data?.tool)).sort()).toEqual(
    [...expectedToolNames].sort(),
  );
  expect(results).toHaveLength(calls.length);
  for (const call of calls) {
    const callId = text(call.data?.toolCallId);
    const result = results.find((candidate) => text(candidate.data?.toolCallId) === callId);
    expect(callId).toBeTruthy();
    expect(result, `missing tool result for ${call.data?.tool}:${callId}`).toBeTruthy();
    expect(result.data?.tool).toBe(call.data?.tool);
    expect(result.data?.success).toBe(true);
    expect(text(result.data?.result)).toBeTruthy();
  }
  return { calls, results };
}

export async function observeRealtimeThinkingChanges(page) {
  const shell = page.locator(".thinking-realtime-shell").last();
  await expect(shell).toBeVisible({ timeout: 60000 });
  if (!(await shell.locator(".thinking-realtime-body").isVisible())) {
    await shell.locator(".el-collapse-item__header").click();
  }
  const signatures = new Set();
  await expect
    .poll(
      async () => {
        const lines = shell.locator(".thinking-realtime-log-stream .base-thinking-log-line");
        const signature = (await lines.allTextContents()).map(text).filter(Boolean).join("|");
        if (signature) signatures.add(signature);
        return signatures.size;
      },
      { timeout: 120000, intervals: [100, 200, 500] },
    )
    .toBeGreaterThanOrEqual(2);
  return shell;
}

export async function assertRealtimeToolDetails(shell, expectedLineCount) {
  await expect(shell.locator(".thinking-analysis-block").first()).not.toBeEmpty();
  const toolLines = shell.locator(".base-thinking-log-line.is-tool");
  await expect(toolLines).toHaveCount(expectedLineCount);
  await expect(
    toolLines.locator(".base-thinking-log-line__event", { hasText: "调用" }),
  ).toHaveCount(expectedLineCount / 2);
  await expect(
    toolLines.locator(".base-thinking-log-line__event", { hasText: "返回" }),
  ).toHaveCount(expectedLineCount / 2);
  for (let index = 0; index < expectedLineCount; index += 1) {
    const line = toolLines.nth(index);
    await expect(line.locator(".base-thinking-log-line__event")).toHaveText(/^(调用|返回)$/);
    await readExpandedToolLine(line);
  }
}

export async function readRealtimeToolProjection(page) {
  const shell = page.locator(".thinking-realtime-shell").last();
  await expect(shell).toBeVisible({ timeout: 60000 });
  const header = shell.locator(".el-collapse-item__header");
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  const toolLines = shell.locator(".base-thinking-log-line.is-tool");
  await expect(toolLines.first()).toBeVisible();
  const projection = [];
  for (let index = 0; index < (await toolLines.count()); index += 1) {
    const line = toolLines.nth(index);
    const trigger = line.locator(".base-thinking-log-line__text");
    const event = text(await line.locator(".base-thinking-log-line__event").textContent());
    const summary = text(await trigger.textContent());
    const expandable = await trigger.evaluate((element) =>
      element.classList.contains("is-expandable"),
    );
    let detail = "";
    if (expandable) {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      const detailNode = line.locator(".base-thinking-log-line__detail");
      await expect(detailNode).toBeVisible();
      detail = text(await detailNode.textContent());
      await trigger.click();
      await expect(detailNode).toBeHidden();
    }
    projection.push({ event, summary, expandable, detail });
  }
  return projection;
}

export async function assertThinkingDetailsDrawer(page, expectedPairCount) {
  const shell = page.locator(".thinking-realtime-shell").last();
  const header = shell.locator(".el-collapse-item__header");
  const action = shell.locator(".thinking-detail-action-button");
  if ((await header.getAttribute("aria-expanded")) !== "true") {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(action).toBeVisible();
  await action.click();
  const panel = page.locator(".thinking-details-panel");
  await expect(panel).toBeVisible();
  const toolLines = panel.locator(".thinking-details-log-body .base-thinking-log-line.is-tool");
  await expect(toolLines).toHaveCount(expectedPairCount * 2);
  const projection = [];
  for (let index = 0; index < expectedPairCount * 2; index += 1) {
    projection.push(await readExpandedToolLine(toolLines.nth(index)));
  }
  await panel.locator(".el-tabs__item").nth(1).click();
  await expect(
    panel.locator(".thinking-details-content-body .base-note-block__content").first(),
  ).not.toBeEmpty();
  return projection;
}

export async function waitForToolSet(userId, sessionId, turnScopeId, expectedToolNames) {
  return waitForSessionExecutionEventTree(
    userId,
    sessionId,
    (records) => {
      const events = toolEventsForTurn(records, turnScopeId);
      const calls = events.filter((event) => event.event === "tool_call_start");
      const results = events.filter((event) => event.event === "tool_call_end");
      return (
        calls.length === expectedToolNames.length && results.length === expectedToolNames.length
      );
    },
    { timeoutMs: 240000 },
  );
}
