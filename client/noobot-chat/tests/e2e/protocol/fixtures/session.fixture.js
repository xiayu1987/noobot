/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { text } from "@noobot/shared/value";

export async function createSessionThroughUi(page) {
  await page.locator(".new-chat-btn").click();
  await expect(page.locator(".chat-input textarea")).toBeVisible();
  const activeSession = page.locator(".session-item.active");
  await expect(activeSession).toHaveAttribute("data-session-id", /.+/);
  return text(await activeSession.getAttribute("data-session-id"));
}
