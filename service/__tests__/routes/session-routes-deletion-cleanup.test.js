/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

test("session-routes: 删除 session 时清理 harness 运行记录", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-session-route-harness-"));
  const runsDir = path.join(basePath, "runtime", "harness", "runs");
  const runDelete = path.join(runsDir, "run-delete");
  const runKeep = path.join(runsDir, "run-keep");
  await fs.mkdir(runDelete, { recursive: true });
  await fs.mkdir(runKeep, { recursive: true });
  await fs.writeFile(
    path.join(runDelete, "harness-run.json"),
    JSON.stringify({ sessionId: "s-delete", dialogProcessId: "run-delete" }, null, 2),
    "utf8",
  );
  await fs.writeFile(
    path.join(runKeep, "harness-run.json"),
    JSON.stringify({ sessionId: "s-keep", dialogProcessId: "run-keep" }, null, 2),
    "utf8",
  );

  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: ["s-delete"] }),
        getAllSessionsData: async () => [],
      },
      getWorkspacePath: () => basePath,
      deleteScopedAttachmentsBySessionIds: async () => ({ deletedCount: 0, deletedSessionIds: [] }),
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-delete`, { method: "DELETE" });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
  });

  await assert.rejects(fs.access(runDelete));
  await fs.access(runKeep);
});
test("session-routes: 删除 session 结果缺失 deletedSessionIds 时仍删除当前 session 附件", async () => {
  const attachmentDeleteCalls = [];
  const overflowDeleteCalls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getWorkspacePath: () => "",
      deleteScopedAttachmentsBySessionIds: async (payload = {}) => {
        attachmentDeleteCalls.push(payload);
        return { deletedCount: Array.isArray(payload?.sessionIds) ? payload.sessionIds.length : 0, deletedSessionIds: payload?.sessionIds || [] };
      },
      deleteToolResultOverflowBySessionIds: async (payload = {}) => {
        overflowDeleteCalls.push(payload);
        return { deletedCount: Array.isArray(payload?.sessionIds) ? payload.sessionIds.length : 0, deletedSessionIds: payload?.sessionIds || [] };
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-fallback-delete`, { method: "DELETE" });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
  });

  assert.equal(attachmentDeleteCalls.length, 1);
  assert.deepEqual(attachmentDeleteCalls[0], {
    userId: "u1",
    sessionIds: ["s-fallback-delete"],
  });
  assert.equal(overflowDeleteCalls.length, 1);
  assert.deepEqual(overflowDeleteCalls[0], {
    userId: "u1",
    sessionIds: ["s-fallback-delete"],
  });
});
