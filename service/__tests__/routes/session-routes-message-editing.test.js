/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionCommand,
  createTurnReplacementCommit,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

function createReplaceTurnResult(payload, {
  version,
  replacedTurnScopeIds,
  replacementUserMessageId,
} = {}) {
  const replacementDialogProcessId = "dialog-replacement";
  const replacementUser = {
    role: "user",
    messageId: replacementUserMessageId,
    dialogProcessId: replacementDialogProcessId,
    turnScopeId: payload.turnScopeId,
  };
  return {
    session: {
      sessionId: payload.sessionId,
      aggregateVersion: version,
      messages: [replacementUser],
    },
    turnReplacement: createTurnReplacementCommit({
      commandId: payload.commandId,
      sessionId: payload.sessionId,
      committedAggregateVersion: version,
      replacedTurnScopeIds,
      replacementDialogProcessId,
      replacementTurnScopeId: payload.turnScopeId,
      replacementUserMessageId,
      committedAt: "2026-07-31T00:00:00.000Z",
    }),
  };
}

function mutationCommand(type, {
  userId = "u1", sessionId = "s1", parentSessionId = "",
  commandId = "test-command", expectedAggregateVersion = 0, ...payload
} = {}) {
  return createSessionCommand({
    commandId, type, scope: { userId, sessionId, parentSessionId },
    expectedAggregateVersion, payload,
  });
}

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
            session: { sessionId: payload.sessionId, messages: [{ id: "m1" }], aggregateVersion: 3 },
            deletedCount: 2,
            anchorIndex: 1,
            deletedTurnScopeIds: ["turn-delete", "turn-tail"],
            aggregateVersion: 3,
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
        ...mutationCommand(SESSION_COMMAND.MESSAGE_DELETE_FROM, {
          parentSessionId: "parent-1", commandId: "idem-1", expectedAggregateVersion: 2,
          anchor: { dialogProcessId: "dp-1" },
        }),
      }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.deletedCount, 2);
    assert.equal(payload.anchorIndex, 1);
    assert.deepEqual(payload.deletedTurnScopeIds, ["turn-delete", "turn-tail"]);
    assert.deepEqual(calls[0], {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "parent-1",
      anchor: { dialogProcessId: "dp-1" },
      expectedAggregateVersion: 2,
      commandId: "idem-1",
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
        body: JSON.stringify(mutationCommand(SESSION_COMMAND.MESSAGE_DELETE_FROM, {
          commandId: `delete-${statusCode}`, anchor: { turnScopeId: "scope-missing" },
        })),
      });
      const payload = await response.json();
      assert.equal(response.status, statusCode);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, `delete-from-${statusCode}`);
    }
  });
});
test("session-routes: rename 路由 trim 标题并返回成功", async () => {
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
        renameSession: async (payload) => {
          calls.push(payload);
          return { sessionId: payload.sessionId, customTitle: payload.title };
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
    const response = await fetch(`${baseUrl}/internal/session/u1/s1/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "  new title  " }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { ok: true, sessionId: "s1", title: "new title" });
    assert.deepEqual(calls[0], { userId: "u1", sessionId: "s1", title: "new title" });
  });
});
test("session-routes: rename 空标题返回 400，session 不存在返回 404", async () => {
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, {
    bot: {
      session: {
        getSessionData: async () => ({}),
        getRootSessionId: async () => "",
        deleteSessionBranch: async () => ({ deletedSessionIds: [] }),
        getAllSessionsData: async () => [],
        renameSession: async () => null,
      },
      getAttachmentById: async () => null,
    },
    handleChat: (_req, res) => res.json({ ok: true }),
    getConnectorChannelStore: () => ({}),
    getConnectorHistoryStore: () => ({}),
    translateText: () => "",
  });

  await withTestServer(app, async (baseUrl) => {
    const emptyResponse = await fetch(`${baseUrl}/internal/session/u1/s1/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    assert.equal(emptyResponse.status, 400);
    assert.equal((await emptyResponse.json()).ok, false);

    const missingResponse = await fetch(`${baseUrl}/internal/session/u1/missing/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "new title" }),
    });
    assert.equal(missingResponse.status, 404);
    assert.equal((await missingResponse.json()).ok, false);
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
          return createReplaceTurnResult(payload, {
            version: 4,
            replacedTurnScopeIds: ["scope-old"],
            replacementUserMessageId: "replacement-user-1",
          });
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
      body: JSON.stringify(mutationCommand(SESSION_COMMAND.TURN_REPLACE, {
        parentSessionId: "parent-1",
        anchor: { turnScopeId: "scope-old" },
        newContent: " edited content ",
        turnScopeId: " turn-scope-replace ",
        expectedAggregateVersion: 3,
        commandId: "idem-2",
      })),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.turnReplacement.replacementTurnScopeId, "turn-scope-replace");
    assert.equal(payload.turnReplacement.replacementDialogProcessId, "dialog-replacement");
    assert.equal(payload.turnReplacement.replacementUserMessageId, "replacement-user-1");
    assert.deepEqual(calls[0], {
      userId: "u1",
      sessionId: "s1",
      parentSessionId: "parent-1",
      anchor: { turnScopeId: "scope-old" },
      newContent: "edited content",
      turnScopeId: "turn-scope-replace",
      expectedAggregateVersion: 3,
      commandId: "idem-2",
    });
  });
});
test("session-routes: replace-turn rejects duplicate /api/internal service route", async () => {
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
          return createReplaceTurnResult(payload, {
            version: 5,
            replacedTurnScopeIds: ["client-turn:api"],
            replacementUserMessageId: "replacement-user-2",
          });
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
      body: JSON.stringify(mutationCommand(SESSION_COMMAND.TURN_REPLACE, {
        userId: "primary-user",
        sessionId: "93606d58-60eb-4ca4-bccf-c926e67e1fed",
        anchor: { turnScopeId: "client-turn:api" },
        newContent: "edited content",
        turnScopeId: "client-turn:api-new",
        expectedAggregateVersion: 2,
        commandId: "replace-api-command",
      })),
    });
    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
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
        body: JSON.stringify(mutationCommand(SESSION_COMMAND.TURN_REPLACE, {
          commandId: `replace-${statusCode}`,
          anchor: { turnScopeId: "scope-missing" }, newContent: "edit", turnScopeId: "scope-new",
        })),
      });
      const payload = await response.json();
      assert.equal(response.status, statusCode);
      assert.equal(payload.ok, false);
      assert.equal(payload.error, `replace-turn-${statusCode}`);
    }
  });
});
