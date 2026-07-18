import test from "node:test";
import assert from "node:assert/strict";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

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
