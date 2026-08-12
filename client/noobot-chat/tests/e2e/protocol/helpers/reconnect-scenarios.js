/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { findProtocolObjects, waitForCaptured } from "./websocket-capture.js";

export async function reloadAndWaitForReconnect(page, capture) {
  const receivedAtStart = capture.websocketReceived.length;
  await page.reload();
  await waitForCaptured(
    () =>
      findProtocolObjects(capture.websocketReceived.slice(receivedAtStart)).find(
        ({ event }) => event === "reconnect_complete",
      ),
    { timeoutMs: 60000 },
  );
  await expect(page.locator(".status-btn.connected")).toBeVisible();
}

export async function beginReload(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".chat-input textarea")).toBeVisible();
}

export async function waitForReconnect(capture, receivedAtStart = 0) {
  return waitForCaptured(
    () =>
      findProtocolObjects(capture.websocketReceived.slice(receivedAtStart)).find(
        ({ event }) => event === "reconnect_complete",
      ),
    { timeoutMs: 60000 },
  );
}

export async function cycleOffline(page, capture) {
  const context = page.context();
  await context.setOffline(true);
  await page.waitForTimeout(500);
  await context.setOffline(false);
  await reloadAndWaitForReconnect(page, capture);
}
