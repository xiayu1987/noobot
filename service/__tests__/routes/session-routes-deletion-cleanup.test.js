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
import { createServicePluginHost } from "../../services/service-plugin-host.js";
import { createPluginServicePorts } from "../../services/plugin-service-ports.js";

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
  const bot = {
    session: {
      getSessionData: async () => ({}),
      getRootSessionId: async () => "",
      deleteSessionBranch: async () => ({ deletedSessionIds: ["s-delete"] }),
      getAllSessionsData: async () => [],
    },
    getWorkspacePath: () => basePath,
    deleteScopedAttachmentsBySessionIds: async () => ({ deletedCount: 0, deletedSessionIds: [] }),
    getAttachmentById: async () => null,
  };
  const pluginHost = createServicePluginHost();
  await pluginHost.registerServiceRoutes(app, {
    ports: createPluginServicePorts({ bot, translateText: (key) => key }),
    translateText: (key) => key,
  });
  registerSessionRoutes(app, {
    bot,
    pluginHost,
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
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
        return {
          deletedCount: Array.isArray(payload?.sessionIds) ? payload.sessionIds.length : 0,
          deletedSessionIds: payload?.sessionIds || [],
        };
      },
      deleteToolResultOverflowBySessionIds: async (payload = {}) => {
        overflowDeleteCalls.push(payload);
        return {
          deletedCount: Array.isArray(payload?.sessionIds) ? payload.sessionIds.length : 0,
          deletedSessionIds: payload?.sessionIds || [],
        };
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-fallback-delete`, {
      method: "DELETE",
    });
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

test("session-routes: plugin related session identities share the authoritative artifact cleanup", async () => {
  const attachmentDeleteCalls = [];
  const overflowDeleteCalls = [];
  const memoryDeleteCalls = [];
  const orphanPruneCalls = [];
  const pluginCleanupCalls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getRootSessionId: async () => "s-delete",
        deleteSessionBranch: async () => ({ deletedSessionIds: ["s-delete"] }),
        listSessionIds: async () => ["s-keep"],
      },
      deleteScopedAttachmentsBySessionIds: async (payload) => {
        attachmentDeleteCalls.push(payload);
        return { deletedCount: payload.sessionIds.length, deletedSessionIds: payload.sessionIds };
      },
      deleteToolResultOverflowBySessionIds: async (payload) => {
        overflowDeleteCalls.push(payload);
        return { deletedCount: payload.sessionIds.length, deletedSessionIds: payload.sessionIds };
      },
      deleteSessionMemoryBySessionIds: async (payload) => {
        memoryDeleteCalls.push(payload);
        return { deletedCount: payload.sessionIds.length };
      },
      pruneOrphanScopedAttachments: async (payload) => {
        orphanPruneCalls.push(payload);
        return { deletedCount: 0, deletedSessionIds: [] };
      },
    },
    pluginHost: {
      getPluginDiagnostics: async () => ({}),
      emitAfterSessionDelete: async (payload) => {
        pluginCleanupCalls.push(payload);
        return {
          deletedRelatedSessionIds: ["workflow-node-session", "s-delete"],
          retainedRelatedSessionIds: ["workflow-node-keep"],
        };
      },
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-delete`, { method: "DELETE" });
    assert.equal(response.status, 200);
  });

  const expected = { userId: "u1", sessionIds: ["s-delete", "workflow-node-session"] };
  assert.deepEqual(attachmentDeleteCalls, [expected]);
  assert.deepEqual(overflowDeleteCalls, [expected]);
  assert.deepEqual(memoryDeleteCalls, [expected]);
  assert.deepEqual(orphanPruneCalls, [
    { userId: "u1", keepSessionIds: ["s-keep", "workflow-node-keep"] },
  ]);
  assert.deepEqual(pluginCleanupCalls[0]?.remainingSessionIds, ["s-keep"]);
});

test("session-routes: orphan attachment cleanup reads ids without loading Session attachment data", async () => {
  const pruneCalls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: ["s-delete"] }),
        listSessionIds: async () => ["s-keep"],
        getAllSessionsData: async () => {
          throw new Error("invalid_attachment_id");
        },
      },
      deleteScopedAttachmentsBySessionIds: async () => ({ deletedCount: 0, deletedSessionIds: [] }),
      pruneOrphanScopedAttachments: async (payload) => {
        pruneCalls.push(payload);
        return { deletedCount: 0, deletedSessionIds: [] };
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-delete`, { method: "DELETE" });
    assert.equal(response.status, 200);
  });
  assert.deepEqual(pruneCalls, [
    {
      userId: "u1",
      keepSessionIds: ["s-keep"],
    },
  ]);
});
