/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";

export async function createSessionThroughUi(page) {
  await page.locator(".new-chat-btn").click();
  await expect(page.locator(".chat-input textarea")).toBeVisible();
  await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.get("session") || ""))
    .not.toBe("");
  return page.evaluate(() => {
    const queryId = new URL(location.href).searchParams.get("session");
    if (queryId) return queryId;
    const routeId = location.pathname.match(/\/sessions?\/([^/]+)/)?.[1];
    return routeId ? decodeURIComponent(routeId) : "";
  });
}
