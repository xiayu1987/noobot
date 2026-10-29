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
import { createScopedSessionArtifactReader } from "noobot-agent/session";
import { TEST_STORAGE_SERVICE } from "../storage-service.test-helpers.js";

const emptyCleanup = async () => ({ deletedCount: 0, deletedSessionIds: [] });

function createDeletionBot({ session = {}, ...overrides } = {}) {
  return {
    session: {
      getRootSessionId: async () => "",
      listSessionIds: async () => [],
      ...session,
    },
    deleteScopedAttachmentsBySessionIds: emptyCleanup,
    deleteSemanticTransferBySessionIds: emptyCleanup,
    deleteSessionMemoryBySessionIds: async () => ({ deletedCount: 0 }),
    pruneOrphanScopedAttachments: emptyCleanup,
    getAttachmentById: async () => null,
    ...overrides,
  };
}

test("session-routes: 删除 session 时清理 harness 运行记录", async () => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-session-route-harness-"));
  const runsDir = path.join(basePath, "runtime", "plugin-data", "harness", "runs");
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
  const bot = createDeletionBot({
    session: {
      ...createScopedSessionArtifactReader({ storageService: TEST_STORAGE_SERVICE }),
      deleteSessionBranch: async () => ({ deletedSessionIds: ["s-delete"] }),
    },
    getWorkspacePath: () => basePath,
  });
  const pluginHost = createServicePluginHost();
  await pluginHost.registerServiceRoutes(app, {
    ports: createPluginServicePorts({ bot, translateText: (key) => key }),
    enforceUserScopeParam: (_req, _res, next) => next(),
    translateText: (key) => key,
  });
  registerSessionRoutes(app, {
    bot,
    pluginHost,
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
test("session-routes: 删除结果缺失 deletedSessionIds 时拒绝且不执行附件清理", async () => {
  const attachmentDeleteCalls = [];
  const semanticTransferDeleteCalls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      session: { deleteSessionBranch: async () => ({ deletedSessionIds: [] }) },
      deleteScopedAttachmentsBySessionIds: async (payload = {}) => {
        attachmentDeleteCalls.push(payload);
        return { deletedCount: 0, deletedSessionIds: [] };
      },
      deleteSemanticTransferBySessionIds: async (payload = {}) => {
        semanticTransferDeleteCalls.push(payload);
        return { deletedCount: 0, deletedSessionIds: [] };
      },
    }),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-missing-result`, {
      method: "DELETE",
    });
    const payload = await response.json();
    assert.equal(response.status, 500);
    assert.equal(payload.ok, false);
  });

  assert.equal(attachmentDeleteCalls.length, 0);
  assert.equal(semanticTransferDeleteCalls.length, 0);
});

test("session-routes: plugin related session identities share the authoritative artifact cleanup", async () => {
  const attachmentDeleteCalls = [];
  const semanticTransferDeleteCalls = [];
  const memoryDeleteCalls = [];
  const orphanPruneCalls = [];
  const pluginCleanupCalls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      session: {
        getRootSessionId: async () => "s-delete",
        deleteSessionBranch: async () => ({ deletedSessionIds: ["s-delete"] }),
        listSessionIds: async () => ["s-keep"],
      },
      deleteScopedAttachmentsBySessionIds: async (payload) => {
        attachmentDeleteCalls.push(payload);
        return { deletedCount: payload.sessionIds.length, deletedSessionIds: payload.sessionIds };
      },
      deleteSemanticTransferBySessionIds: async (payload) => {
        semanticTransferDeleteCalls.push(payload);
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
    }),
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
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-delete`, { method: "DELETE" });
    assert.equal(response.status, 200);
  });

  const expected = { userId: "u1", sessionIds: ["s-delete", "workflow-node-session"] };
  assert.deepEqual(attachmentDeleteCalls, [expected]);
  assert.deepEqual(semanticTransferDeleteCalls, [expected]);
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
    bot: createDeletionBot({
      session: {
        deleteSessionBranch: async () => ({ deletedSessionIds: ["s-delete"] }),
        listSessionIds: async () => ["s-keep"],
        getAllSessionsData: async () => {
          throw new Error("invalid_attachment_id");
        },
      },
      pruneOrphanScopedAttachments: async (payload) => {
        pruneCalls.push(payload);
        return { deletedCount: 0, deletedSessionIds: [] };
      },
    }),
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

test("session-routes: 批量删除按 sessionIds 一次删除多个分支并统一清理", async () => {
  const deleteBranchCalls = [];
  const attachmentDeleteCalls = [];
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      session: {
        deleteSessionBranch: async (payload) => {
          deleteBranchCalls.push(payload);
          return { ok: true, deletedSessionIds: ["s-a", "s-a-child", "s-b"] };
        },
        listSessionIds: async () => ["s-keep"],
      },
      deleteScopedAttachmentsBySessionIds: async (payload) => {
        attachmentDeleteCalls.push(payload);
        return { deletedCount: payload.sessionIds.length, deletedSessionIds: payload.sessionIds };
      },
    }),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/sessions/u1/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds: ["s-a", "s-b"] }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.deletedSessionIds, ["s-a", "s-a-child", "s-b"]);
  });

  assert.deepEqual(deleteBranchCalls, [{ userId: "u1", sessionIds: ["s-a", "s-b"] }]);
  assert.deepEqual(attachmentDeleteCalls, [
    { userId: "u1", sessionIds: ["s-a", "s-a-child", "s-b"] },
  ]);
});

test("session-routes: 批量删除拒绝非法 sessionIds 且不触发删除", async () => {
  const deleteBranchCalls = [];
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      session: {
        deleteSessionBranch: async (payload) => {
          deleteBranchCalls.push(payload);
          return { ok: true, deletedSessionIds: [] };
        },
      },
    }),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    for (const body of [
      {},
      { sessionIds: [] },
      { sessionIds: ["s-a", " "] },
      { sessionIds: [1] },
    ]) {
      const response = await fetch(`${baseUrl}/internal/sessions/u1/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).ok, false);
    }
  });
  assert.equal(deleteBranchCalls.length, 0);
});
