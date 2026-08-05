/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";

test("@core PBE-030 未 provision 的本地 Session 刷新不污染权威路由", async ({ noobot }) => {
  const localSessionId = noobot.sessionId;
  const persistedSessionIds = await noobot.page.locator(".session-item").evaluateAll((items) =>
    items.filter((item) => item.dataset.sessionLocal !== "true")
      .map((item) => String(item.dataset.sessionId || ""))
      .filter(Boolean));
  expect(new URL(noobot.page.url()).searchParams.has("session")).toBe(false);
  await expect(noobot.page.locator(".session-item.active")).toHaveAttribute("data-session-id", localSessionId);

  await noobot.page.reload({ waitUntil: "domcontentloaded" });
  await expect(noobot.page.locator(".status-btn.connected")).toBeVisible();
  await expect(noobot.page.getByText("Session not found", { exact: true })).toHaveCount(0);
  await expect(noobot.page.getByText("会话不存在", { exact: true })).toHaveCount(0);
  const refreshedSessionIds = await noobot.page.locator(".session-item").evaluateAll((items) =>
    items.map((item) => String(item.dataset.sessionId || "")).filter(Boolean));
  expect(persistedSessionIds.every((sessionId) => refreshedSessionIds.includes(sessionId))).toBe(true);
  const recoveredSessionId = new URL(noobot.page.url()).searchParams.get("session") || "";
  expect(recoveredSessionId).not.toBe(localSessionId);
  if (recoveredSessionId) expect(refreshedSessionIds).toContain(recoveredSessionId);
});
