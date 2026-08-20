/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

test("session-routes: streams an attachment opened by the canonical attachment service", async () => {
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      openAttachmentStream: async () => ({
        name: "report.txt",
        mimeType: "text/plain",
        stream: Readable.from(["canonical attachment"]),
      }),
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText: (key) => key,
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/attachment/u1/a1?sessionId=s1&attachmentSource=user`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/plain");
    assert.equal(await response.text(), "canonical attachment");
  });
});

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
      openAttachmentStream: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
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

for (const [label, query] of [
  ["缺失 sessionId", { attachmentSource: "user" }],
  ["缺失 attachmentSource", { sessionId: "s1" }],
]) {
  test(`session-routes: ${label} 的附件访问拒绝跨作用域查询`, async () => {
    let called = false;
    const app = express();
    registerSessionRoutes(app, {
      bot: {
        session: {
          getSessionData: async () => ({}),
          getRootSessionId: async () => "",
          deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
          getAllSessionsData: async () => [],
        },
        openAttachmentStream: async () => {
          called = true;
          return { absolutePath: "/tmp/should-not-be-read" };
        },
      },
      handleChat: (_req, res) => res.json({ ok: true }),
      translateText: (key) => (key === "common.attachmentNotFound" ? "attachment-not-found" : key),
    });

    await withTestServer(app, async (baseUrl) => {
      const params = new URLSearchParams(query);
      const response = await fetch(`${baseUrl}/internal/attachment/u1/a1?${params}`);
      const payload = await response.json();
      assert.equal(response.status, 404);
      assert.equal(payload.error, "attachment-not-found");
    });
    assert.equal(called, false);
  });
}
test("session-routes: 会话查询异常返回 400 + 标准错误体", async () => {
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionDisplayData: async () => {
          throw new Error("session-read-failed");
        },
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
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

test("session-routes: terminal resolution uses only canonical Session identity", async () => {
  const calls = [];
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        resolveTurnTerminalState: async (payload) => {
          calls.push(payload);
          return {
            resolved: true,
            sessionId: payload.sessionId,
            turnScopeId: payload.turnScopeId,
            turn: {
              state: "completed",
              executionState: "completed",
              revision: 4,
              sequence: 4,
              terminalStatus: { command: "completed" },
            },
          };
        },
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText: () => "",
  });
  await withTestServer(app, async (baseUrl) => {
    const query = new URLSearchParams({
      commandId: "terminal-command",
    });
    const response = await fetch(
      `${baseUrl}/internal/session/user-a/child-session/turns/turn-a/terminal?${query}`,
    );
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.resolved, true);
  });

  assert.deepEqual(calls, [
    {
      userId: "user-a",
      sessionId: "child-session",
      turnScopeId: "turn-a",
      commandId: "terminal-command",
    },
  ]);
});

test("session-routes: terminal resolution rejects storage locator query fields", async () => {
  let called = false;
  const app = express();
  registerSessionRoutes(app, {
    bot: {
      session: {
        resolveTurnTerminalState: async () => {
          called = true;
          return { resolved: false };
        },
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const response = await fetch(
      `${baseUrl}/internal/session/user-a/child-session/turns/turn-a/terminal?persistenceScope=%7Bbad`,
    );
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
  });
  assert.equal(called, false);
});
