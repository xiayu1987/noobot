/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionReaderAccess } from "../../../agent/__tests__/helpers/partition-reader-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";
import { createServicePluginHost } from "../../services/service-plugin-host.js";
import { createPluginServicePorts } from "../../services/plugin-service-ports.js";
import { createScopedSessionArtifactReader } from "noobot-agent/session";
import { SessionPageSnapshots } from "../../../agent/src/session/session-page-snapshots.js";
import { TEST_STORAGE_SERVICE } from "../storage-service.test-helpers.js";
import { AttachmentService } from "../../../agent/src/artifacts/index.js";
import { attachScopeRoot } from "../../../agent/src/artifacts/service/attachment-storage-layout.js";
import {
  SESSION_DELETION_STAGE,
  sessionBranchDeletionKey,
} from "@noobot/workspace-protocol/session-tombstone";

const emptyCleanup = async () => ({ deletedCount: 0, deletedSessionIds: [] });

function createDeletionBot({ session = {}, planBranch, ...overrides }) {
  return {
    session: {
      getRootSessionId: async () => "",
      ...session,
      async deleteSessionBranch(request, cleanup) {
        const deletedSessionIds = await planBranch(request);
        const deletionKey = sessionBranchDeletionKey(request.sessionIds);
        const scope = { userId: request.userId, deletionKey, deletedSessionIds };
        const pluginHandlerIds = await cleanup({
          ...scope,
          stage: SESSION_DELETION_STAGE.PLAN_PLUGINS,
        });
        for (const stage of [
          SESSION_DELETION_STAGE.PLUGINS,
          SESSION_DELETION_STAGE.ATTACHMENTS,
          SESSION_DELETION_STAGE.SHORT_MEMORY,
        ]) {
          await cleanup({ ...scope, stage, pluginHandlerIds });
        }
        return { ok: true, deletedSessionIds };
      },
    },
    deleteScopedAttachmentsBySessionIds: emptyCleanup,
    deleteSessionMemoryBySessionIds: async () => ({ deletedCount: 0 }),
    getAttachmentById: async () => null,
    ...overrides,
  };
}

test("session-routes: 删除 session 时清理 harness 运行记录", async (t) => {
  const basePath = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-session-route-harness-"));
  t.after(() => fs.rm(basePath, { recursive: true, force: true }));
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
  const pageSnapshots = new SessionPageSnapshots();
  t.after(() => pageSnapshots.close());
  const bot = createDeletionBot({
    session: {
      ...createScopedSessionArtifactReader({
        storageService: TEST_STORAGE_SERVICE,
        sessionReaderAccess: partitionReaderAccess,
        pageSnapshots,
        assertAuthorityActive: async () => {},
        withDeletionFence: (_userId, read) => read(),
      }),
    },
    planBranch: () => ["s-delete"],
    getWorkspacePath: () => basePath,
  });
  const pluginHost = createServicePluginHost();
  await pluginHost.registerServiceRoutes(app, {
    runBotOperation: (operation) => operation(),
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
    const url = `${baseUrl}/internal/session/u1/s-delete`;
    const response = await fetch(url, { method: "DELETE" });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
  });

  await assert.rejects(fs.access(runDelete));
  await fs.access(runKeep);
});
test("session-routes: branch planning failure prevents attachment cleanup", async () => {
  const attachmentDeleteCalls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      planBranch: () => {
        throw new Error("branch planning failed");
      },
      deleteScopedAttachmentsBySessionIds: async (payload = {}) => {
        attachmentDeleteCalls.push(payload);
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
});

test("session-routes: every cleanup stage receives the authoritative branch identities", async () => {
  const attachmentDeleteCalls = [];
  const memoryDeleteCalls = [];
  const pluginCleanupCalls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      planBranch: () => ["s-delete", "workflow-node-session"],
      deleteScopedAttachmentsBySessionIds: async (payload) => {
        attachmentDeleteCalls.push(payload);
        return { deletedCount: payload.sessionIds.length, deletedSessionIds: payload.sessionIds };
      },
      deleteSessionMemoryBySessionIds: async (payload) => {
        memoryDeleteCalls.push(payload);
        return { deletedCount: payload.sessionIds.length };
      },
    }),
    pluginHost: {
      listSessionDeletionHandlers: () => [],
      getPluginDiagnostics: async () => ({}),
      emitAfterSessionDelete: async (payload) => {
        pluginCleanupCalls.push(payload);
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
  assert.deepEqual(memoryDeleteCalls, [expected]);
  assert.deepEqual(
    pluginCleanupCalls.map(({ userId, deletionKey, deletedSessionIds }) => ({
      userId,
      deletionKey,
      deletedSessionIds,
    })),
    [
      {
        userId: "u1",
        deletionKey: sessionBranchDeletionKey(["s-delete"]),
        deletedSessionIds: expected.sessionIds,
      },
    ],
  );
});

test("session-routes: only explicitly owned attachments are removed", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-delete-attachments-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const basePath = path.join(workspaceRoot, "u1");
  const attachments = new AttachmentService({ workspaceRoot });
  const ids = ["s-delete", "plugin-node", "not-in-session-tree"];
  const directories = ids.map((sessionId) =>
    attachScopeRoot(basePath, { sessionId, attachmentSource: "tool" }),
  );
  for (const directory of directories) await fs.mkdir(directory, { recursive: true });
  const app = express();
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      planBranch: () => ids.slice(0, 2),
      deleteScopedAttachmentsBySessionIds: (payload) =>
        attachments.deleteScopedAttachmentsBySessionIds(payload),
    }),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s-delete`, { method: "DELETE" });
    assert.equal(response.status, 200);
  });
  await assert.rejects(fs.stat(directories[0]), { code: "ENOENT" });
  await assert.rejects(fs.stat(directories[1]), { code: "ENOENT" });
  await fs.stat(directories[2]);
});

test("session-routes: 批量删除按 sessionIds 一次删除多个分支并统一清理", async () => {
  const deleteBranchCalls = [];
  const attachmentDeleteCalls = [];
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, {
    bot: createDeletionBot({
      planBranch: (payload) => {
        deleteBranchCalls.push(payload);
        return ["s-a", "s-a-child", "s-b"];
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
      planBranch: (payload) => {
        deleteBranchCalls.push(payload);
        throw new Error("invalid request reached branch planning");
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
