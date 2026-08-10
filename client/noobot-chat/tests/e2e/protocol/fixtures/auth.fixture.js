/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export function readE2eCredentials(env = process.env) {
  const userId = String(env.NOOBOT_E2E_USER_ID || "").trim();
  const connectCode = String(env.NOOBOT_E2E_CONNECT_CODE || "").trim();
  if (!userId || !connectCode) {
    throw new Error("NOOBOT_E2E_USER_ID and NOOBOT_E2E_CONNECT_CODE are required");
  }
  return Object.freeze({ userId, connectCode });
}

export async function connectThroughUi(page, credentials) {
  await page.locator(".custom-input input").first().fill(credentials.userId);
  await page.locator(".connect-input input").fill(credentials.connectCode);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/internal/connect") && response.request().method() === "POST",
  );
  await page.locator(".connect-btn").click();
  const response = await responsePromise;
  await expect(page.locator(".status-btn.connected")).toBeVisible();
  await expect(page.locator(".connect-btn")).not.toHaveClass(/is-loading/);
  return response.json();
}
