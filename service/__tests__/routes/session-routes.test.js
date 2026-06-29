import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { registerSessionRoutes } from "../../routes/session-routes.js";
import { createJsonRouteWrapper } from "../../routes/route-wrapper.js";
import { registerServiceRoutes as registerWorkflowServiceRoutes } from "../../../plugin/noobot-plugin-workflow/src/service/routes.js";

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
        body: JSON.stringify({ anchor: { turnScopeId: "scope-missing" } }),
      });
      const payload = await response.json();
      assert.equal(response.status, statusCode);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, `delete-from-${statusCode}`);
    }
  });
});

test("session-routes: replace-turn 路由透传请求体并返回后端快照", async () => {
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
        replaceTurn: async (payload) => {
          calls.push(payload);
          return {
            session: { sessionId: payload.sessionId, messages: [{ turnScopeId: "scope-new" }], version: 4 },
            replacedTurn: { deletedCount: 2 },
            newTurn: { turnScopeId: "scope-new" },
            version: 4,
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
    const response = await fetch(`${baseUrl}/internal/session/u1/s1/messages/replace-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentSessionId: " parent-1 ",
        anchor: { turnScopeId: "scope-old" },
        newContent: " edited content ",
        turnScopeId: " turn-scope-replace ",
        expectedVersion: 3,
        idempotencyKey: " idem-2 ",
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.newTurn.turnScopeId, "scope-new");
    assert.deepEqual(calls[0], {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "parent-1",
      anchor: { turnScopeId: "scope-old" },
      newContent: "edited content",
      turnScopeId: "turn-scope-replace",
      expectedVersion: 3,
      idempotencyKey: "idem-2",
    });
  });
});

test("session-routes: replace-turn 兼容 /api/internal 前缀", async () => {
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
        replaceTurn: async (payload) => {
          calls.push(payload);
          return {
            session: { sessionId: payload.sessionId, messages: [], version: 5 },
            newTurn: { turnScopeId: "client-turn:api-new" },
            version: 5,
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
    const response = await fetch(`${baseUrl}/api/internal/session/primary-user/93606d58-60eb-4ca4-bccf-c926e67e1fed/messages/replace-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anchor: { turnScopeId: "client-turn:api" },
        newContent: "edited content",
        expectedVersion: 2,
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].userId, "primary-user");
    assert.equal(calls[0].sessionId, "93606d58-60eb-4ca4-bccf-c926e67e1fed");
    assert.deepEqual(calls[0].anchor, { turnScopeId: "client-turn:api" });
  });
});

test("session-routes: replace-turn 保留服务层 404/409 状态码", async () => {
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
        replaceTurn: async () => {
          const statusCode = errors.shift();
          const error = new Error(`replace-turn-${statusCode}`);
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
      const response = await fetch(`${baseUrl}/internal/session/u1/s1/messages/replace-turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor: { turnScopeId: "scope-missing" }, newContent: "edit" }),
      });
      const payload = await response.json();
      assert.equal(response.status, statusCode);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, `replace-turn-${statusCode}`);
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

test("session-routes: session 详情默认返回展示概要，full 模式按需返回完整数据", async () => {
  const app = express();
  let summaryCalled = false;
  let fullCalled = false;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionDisplayData: async () => {
          summaryCalled = true;
          return {
            exists: true,
            sessionId: "s1",
            summary: true,
            sessions: [{
              sessionId: "s1",
              messages: [{
                id: "a1",
                role: "assistant",
                content: "summary answer",
                hasThinkingDetails: true,
                thinkingDetailCount: 2,
              }],
              toolLogSummaries: [{ event: "tool_call", text: "read_file /tmp/a" }],
              stats: { messageCount: 4, injectedMessageCount: 1, thinkingMessageCount: 1 },
            }],
          };
        },
        getSessionData: async () => {
          fullCalled = true;
          return {
            exists: true,
            sessionId: "s1",
            sessions: [{
              sessionId: "s1",
              messages: [{
                id: "a1",
                role: "assistant",
                content: "full answer",
                realtimeLogs: [{ event: "thinking", text: "full thinking" }],
                injectedMessage: true,
              }],
              sessionDocs: [{ id: "doc-1" }],
              rawMessages: [{ role: "assistant", content: "raw" }],
            }],
          };
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
    let response = await fetch(`${baseUrl}/internal/session/u1/s1`);
    let payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.summary, true);
    assert.equal(summaryCalled, true);
    assert.equal(fullCalled, false);
    assert.equal(payload.sessions[0].messages[0].hasThinkingDetails, true);
    assert.equal("realtimeLogs" in payload.sessions[0].messages[0], false);
    assert.equal("sessionDocs" in payload.sessions[0], false);
    assert.equal("rawMessages" in payload.sessions[0], false);

    response = await fetch(`${baseUrl}/internal/session/u1/s1?mode=full`);
    payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(fullCalled, true);
    assert.equal(payload.sessions[0].messages[0].realtimeLogs.length, 1);
    assert.equal(payload.sessions[0].sessionDocs.length, 1);
    assert.equal(payload.sessions[0].rawMessages.length, 1);
  });
});

test("session-routes: thinking-detail 仅按 dialogProcessId 返回本次对话明细", async () => {
  const app = express();
  let fullCalled = false;
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => {
          fullCalled = true;
          return {
            exists: true,
            sessionId: "s1",
            sessions: [{
              sessionId: "s1",
              rawMessages: [
                { id: "a1", role: "assistant", type: "message", dialogProcessId: "dp-1", content: "answer" },
                { id: "i1", role: "system", dialogProcessId: "dp-1", injectedMessage: true, injectedBy: "harness-plugin", content: "injected without round" },
                { id: "t1", role: "assistant", type: "tool_call", dialogProcessId: "dp-1", content: "tool call" },
                { id: "t2", role: "tool", type: "tool_result", dialogProcessId: "dp-1", content: "tool result" },
                { id: "a2", role: "assistant", type: "message", dialogProcessId: "dp-2", content: "other answer" },
                { id: "t3", role: "assistant", type: "tool_call", dialogProcessId: "dp-2", content: "other tool" },
              ],
            }],
          };
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
    const response = await fetch(`${baseUrl}/internal/session/u1/s1/thinking-detail?dialogProcessId=dp-1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.exists, true);
    assert.equal(fullCalled, true);
    assert.equal(payload.messageItem.dialogProcessId, "dp-1");
    assert.equal(payload.messageItem.hasThinkingDetails, true);
    assert.equal(payload.counts.executionLogCount, 2);
    assert.equal(payload.counts.injectedMessageCount, 1);
    assert.deepEqual(payload.allMessages.map((item) => item.id).sort(), ["a1", "i1", "t1", "t2"]);
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

test("session-routes: workflow session returns summary and execution jsonl from scoped path", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-session-route-"));
  const workflowDir = path.join(workspaceRoot, "runtime/workflow/session/root-s/wf_node_1");
  await fs.mkdir(workflowDir, { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(workflowDir, "session.json"),
      `${JSON.stringify({ sessionId: "node-s", messages: [{ role: "assistant", content: "done" }] })}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(workflowDir, "session-summary.json"),
      `${JSON.stringify({
        schemaVersion: 5,
        sessionId: "node-s",
        messages: [{ role: "assistant", content: "done" }],
        stats: { messageCount: 1 },
      })}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(workflowDir, "task.json"),
      `${JSON.stringify({ sessionId: "node-s", tasks: [] })}\n`,
      "utf8",
    ),
    fs.writeFile(
      path.join(workflowDir, "execution.json"),
      `${JSON.stringify({ sessionId: "node-s" })}\n`,
      "utf8",
    ),
    fs.writeFile(path.join(workflowDir, "execution.jsonl"), `${JSON.stringify({ event: "x" })}\n`, "utf8"),
    fs.writeFile(path.join(workflowDir, "meta.json"), `${JSON.stringify({ nodeId: "n1" })}\n`, "utf8"),
  ]);

  const app = express();
  const bot = {
    session: {
      getSessionData: async () => ({}),
      getRootSessionId: async () => "",
      deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
      getAllSessionsData: async () => [],
    },
    getWorkspacePath: () => workspaceRoot,
    getAttachmentById: async () => null,
  };
  const translateText = (key) => key;
  registerSessionRoutes(app, {
    bot,
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText,
  });
  registerWorkflowServiceRoutes(app, {
    bot,
    translateText,
    jsonRoute: createJsonRouteWrapper({ translateText }),
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.workflowSession.session.sessionId, "node-s");
    assert.equal(payload.workflowSession.sessionSummary.sessionId, "node-s");
    assert.deepEqual(payload.workflowSession.executionLogs, [{ event: "x" }]);
  });
});

test("session-routes: workflow thinking-detail reads scoped session artifact by turnScopeId", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "noobot-workflow-thinking-route-"));
  const workflowDir = path.join(workspaceRoot, "runtime/workflow/session/root-s/wf_node_1");
  const turnScopeId = "workflow-node:wf_node_1";
  await fs.mkdir(workflowDir, { recursive: true });
  await fs.writeFile(
    path.join(workflowDir, "session.json"),
    `${JSON.stringify({
      sessionId: "node-s",
      messages: [
        { id: "a1", role: "assistant", type: "message", sessionId: "node-s", dialogProcessId: "dp-1", turnScopeId, content: "answer" },
        { id: "i1", role: "system", sessionId: "node-s", dialogProcessId: "dp-1", turnScopeId, injectedMessage: true, injectedBy: "harness-plugin", content: "injected" },
        { id: "t1", role: "assistant", type: "tool_call", sessionId: "node-s", dialogProcessId: "dp-1", turnScopeId, content: "tool call" },
        { id: "t2", role: "tool", type: "tool_result", sessionId: "node-s", dialogProcessId: "dp-1", turnScopeId, content: "tool result" },
        { id: "other", role: "assistant", type: "tool_call", sessionId: "node-s", dialogProcessId: "dp-2", turnScopeId: "workflow-node:other", content: "other" },
      ],
    })}\n`,
    "utf8",
  );

  const app = express();
  const bot = {
    session: {
      getSessionData: async () => ({}),
      getRootSessionId: async () => "",
      deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
      getAllSessionsData: async () => [],
    },
    getWorkspacePath: () => workspaceRoot,
    getAttachmentById: async () => null,
  };
  const translateText = (key) => key;
  registerSessionRoutes(app, {
    bot,
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText,
  });
  registerWorkflowServiceRoutes(app, {
    bot,
    translateText,
    jsonRoute: createJsonRouteWrapper({ translateText }),
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/workflow/session/u1/root-s/wf_node_1/thinking-detail?turnScopeId=${encodeURIComponent(turnScopeId)}`,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.exists, true);
    assert.equal(payload.sessionId, "node-s");
    assert.equal(payload.messageItem.turnScopeId, turnScopeId);
    assert.equal(payload.counts.executionLogCount, 2);
    assert.equal(payload.counts.injectedMessageCount, 1);
    assert.deepEqual(payload.allMessages.map((item) => item.id).sort(), ["a1", "i1", "t1", "t2"]);
  });
});
