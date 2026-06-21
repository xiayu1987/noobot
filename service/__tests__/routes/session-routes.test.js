import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { registerSessionRoutes } from "../../routes/session-routes.js";

async function withTestServer(app, run) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

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

test("session-routes: delete-from 路由透传请求体并返回后端快照", async () => {
  const calls = [];
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
        deleteFromMessage: async (payload) => {
          calls.push(payload);
          return {
            session: { id: payload.sessionId, messages: [{ id: "m1" }], version: 3 },
            deletedCount: 2,
            anchorIndex: 1,
            version: 3,
          };
        },
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/session/u1/s1/messages/delete-from`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentSessionId: " parent-1 ",
        anchor: { dialogProcessId: "dp-1" },
        expectedVersion: 2,
        idempotencyKey: " idem-1 ",
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.deletedCount, 2);
    assert.equal(payload.anchorIndex, 1);
    assert.deepEqual(calls[0], {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "parent-1",
      anchor: { dialogProcessId: "dp-1" },
      expectedVersion: 2,
      idempotencyKey: "idem-1",
    });
  });
});

test("session-routes: delete-from 保留服务层 404/409 状态码", async () => {
  const app = express();
  app.use(express.json());
  const errors = [404, 409];
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
        deleteFromMessage: async () => {
          const statusCode = errors.shift();
          const error = new Error(`delete-from-${statusCode}`);
          error.statusCode = statusCode;
          throw error;
        },
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    for (const statusCode of [404, 409]) {
      const response = await fetch(`${baseUrl}/internal/session/u1/s1/messages/delete-from`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor: { messageId: "m-missing" } }),
      });
      const payload = await response.json();
      assert.equal(response.status, statusCode);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, `delete-from-${statusCode}`);
    }
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

test("session-routes: sessions 列表只读取并返回概要", async () => {
  const app = express();
  let fullDataCalled = false;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => {
          fullDataCalled = true;
          return [{ sessionId: "full", messages: [{ role: "user", content: "full" }] }];
        },
        getAllSessionSummaries: async () => [
          {
            sessionId: "s1",
            parentSessionId: "",
            caller: "user",
            currentTaskId: "t1",
            createdAt: "2026-05-14T00:00:00.000Z",
            updatedAt: "2026-05-14T00:01:00.000Z",
            depth: 1,
            title: "hello",
            messageCount: 2,
            lastMessage: { role: "assistant", content: "ok" },
          },
        ],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/sessions/u1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(fullDataCalled, false);
    assert.equal(payload.sessions.length, 1);
    assert.equal(payload.sessions[0].sessionId, "s1");
    assert.equal("messages" in payload.sessions[0], false);
    assert.equal("sessionDocs" in payload.sessions[0], false);
    assert.equal("rawMessages" in payload.sessions[0], false);
  });
});

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
