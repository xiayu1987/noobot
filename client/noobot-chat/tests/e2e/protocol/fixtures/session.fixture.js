/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { expect } from "@playwright/test";
import { text } from "@noobot/shared/value";

export async function createSessionThroughUi(page) {
  await expect(page.locator(".refresh-btn")).not.toHaveClass(/is-loading/);
  const activeSession = page.locator('.session-item[aria-current="true"]');
  const previousSessionId = (await activeSession.count())
    ? await activeSession.getAttribute("data-session-id")
    : null;
  await page.locator(".new-chat-btn").click();
  await expect(page.locator(".chat-input textarea")).toBeVisible();
  await expect(activeSession).toHaveAttribute("data-session-id", /.+/);
  if (previousSessionId)
    await expect(activeSession).not.toHaveAttribute("data-session-id", previousSessionId);
  return text(await activeSession.getAttribute("data-session-id"));
}
