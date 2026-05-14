import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerSessionRoutes } from "../../routes/session-routes.js";

async function withTestServer(app, run) {
  const server = await new Promise((resolve) => {
    const started = app.listen(0, () => resolve(started));
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
