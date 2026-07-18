/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

test("session-routes: 附件不存在返回 404 + 标准错误体", async () => {
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: (key) => (key === "common.attachmentNotFound" ? "attachment-not-found" : key),
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/attachment/u1/a1`);
    const payload = await response.json();
    assert.equal(response.status, 404);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "attachment-not-found");
  });
});
test("session-routes: 会话查询异常返回 400 + 标准错误体", async () => {
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => {
          throw new Error("session-read-failed");
        },
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s1`);
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "session-read-failed");
  });
});
test("session-routes: 插件诊断接口返回发现/加载/错误信息", async () => {
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/plugins`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(typeof payload?.plugins?.discoveredCount, "number");
    assert.equal(typeof payload?.plugins?.loadedCount, "number");
    assert.equal(typeof payload?.plugins?.skippedCount, "number");
    assert.ok(Array.isArray(payload?.plugins?.pluginIds));
    assert.ok(Array.isArray(payload?.plugins?.loaded));
    assert.ok(Array.isArray(payload?.plugins?.skipped));
    assert.ok(Array.isArray(payload?.plugins?.errors));
  });
});
