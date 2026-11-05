/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { test, expect } from "../fixtures/noobot.fixture.js";
import { splitServerNow } from "@noobot/session-protocol/server-clock";

test("@core PBE-030 未 provision 的本地 Session 刷新不污染权威路由", async ({ noobot }) => {
  const localSessionId = noobot.sessionId;
  const persistedSessionIds = await noobot.page.locator(".session-item").evaluateAll((items) =>
    items
      .filter((item) => item.dataset.sessionLocal !== "true")
      .map((item) => String(item.dataset.sessionId || ""))
      .filter(Boolean),
  );
  expect(new URL(noobot.page.url()).searchParams.has("session")).toBe(false);
  await expect(noobot.page.locator(".session-item.active")).toHaveAttribute(
    "data-session-id",
    localSessionId,
  );

  const listResponsePromise = noobot.page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/internal/sessions/${encodeURIComponent(noobot.userId)}` &&
      response.request().method() === "GET" &&
      response.ok(),
  );
  await noobot.page.reload({ waitUntil: "domcontentloaded" });
  const { document: sessionList } = splitServerNow(await (await listResponsePromise).json());
  expect(sessionList.ok).toBe(true);
  await expect(noobot.page.locator(".sidebar-settings-btn")).toHaveAttribute(
    "data-connected",
    "true",
  );
  await expect(noobot.page.getByText("Session not found", { exact: true })).toHaveCount(0);
  await expect(noobot.page.getByText("会话不存在", { exact: true })).toHaveCount(0);
  await expect
    .poll(async () => {
      const sessionIds = await noobot.page
        .locator(".session-item")
        .evaluateAll((items) =>
          items.map((item) => String(item.dataset.sessionId || "")).filter(Boolean),
        );
      return persistedSessionIds.every((sessionId) => sessionIds.includes(sessionId));
    })
    .toBe(true);
  const refreshedSessionIds = await noobot.page
    .locator(".session-item")
    .evaluateAll((items) =>
      items.map((item) => String(item.dataset.sessionId || "")).filter(Boolean),
    );
  const recoveredSessionId = new URL(noobot.page.url()).searchParams.get("session") || "";
  expect(recoveredSessionId).not.toBe(localSessionId);
  if (recoveredSessionId) expect(refreshedSessionIds).toContain(recoveredSessionId);
});
