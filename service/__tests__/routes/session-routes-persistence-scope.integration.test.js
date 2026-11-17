/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import { createSessionFacade, createSessionServices } from "noobot-agent/session";
import { AttachmentService } from "noobot-agent/attach";
import { resolveScopedSessionRoots } from "@noobot/workspace-protocol";
import { buildExecutionReport } from "@noobot/session-protocol/execution-report";
import {
  createSessionCommand,
  requireMessageDeleteResponse,
  requireTurnReplaceResponse,
  SESSION_COMMAND,
} from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { initializeUserRuntimeDirectories } from "../runtime-events-root.test-helpers.js";
import express, { registerSessionRoutes, withTestServer } from "./session-routes.helpers.js";

const USER_ID = "user-1";
const SESSION_ID = "root-session";

async function withRealFacadeServer(operation) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-http-scope-"));
  try {
    await initializeUserRuntimeDirectories(workspaceRoot, USER_ID);
    const runtime = createSessionServices(
      { workspaceRoot },
      {
        now: () => new Date().toISOString(),
        attachmentService: new AttachmentService({ workspaceRoot }),
        scopedSessionRoots: resolveScopedSessionRoots([
          { pluginId: "workflow", scopedSessionRoots: ["session"] },
        ]),
      },
    );
    const session = createSessionFacade(runtime);
    await session.createSession({
      userId: USER_ID,
      sessionId: SESSION_ID,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      persistenceScope: null,
    });
    const app = express();
    app.use(express.json());
    registerSessionRoutes(app, {
      bot: {
        session,
        replaceSessionTurn: (payload) => session.replaceTurn(payload),
        getAttachmentById: async () => null,
      },
      handleChat: (_req, res) => res.end(),
      translateText: (key) => key,
    });
    return await withTestServer(app, (baseUrl) => operation({ baseUrl, session }));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

function sessionCommandBody(type, payload) {
  return createSessionCommand({
    commandId: `command-${type}`,
    type,
    scope: { userId: USER_ID, sessionId: SESSION_ID, parentSessionId: "" },
    expectedAggregateVersion: 0,
    payload,
  });
}

async function assertScopeAccepted(response) {
  const body = await response.text();
  assert.notEqual(response.status, 400, body);
  assert.doesNotMatch(body, /persistence scope|parentSessionId/);
}

test("session-routes: HTTP 调用经真实 facade 绑定根会话 persistence scope", async () => {
  await withRealFacadeServer(async ({ baseUrl, session }) => {
    const sessionUrl = `${baseUrl}/internal/session/${USER_ID}/${SESSION_ID}`;
    await session.saveExecutionReport({
      userId: USER_ID,
      sessionId: SESSION_ID,
      persistenceScope: null,
      report: buildExecutionReport({
        status: "completed",
        sessionId: SESSION_ID,
        dialogProcessId: "dp-1",
        startedAt: "2026-07-18T00:00:00.000Z",
        finishedAt: "2026-07-18T00:00:01.000Z",
        summaryError: new Error("summary unavailable"),
      }),
    });

    const report = await fetch(`${sessionUrl}/execution-report?dialogProcessId=dp-1`);
    const reportBody = await report.json();
    assert.equal(report.status, 200, JSON.stringify(reportBody));
    assert.equal(reportBody.report.dialogProcessId, "dp-1");

    await assertScopeAccepted(await fetch(`${sessionUrl}/turns/turn-a/terminal?commandId=c-1`));

    const rename = await fetch(`${sessionUrl}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "renamed" }),
    });
    assert.equal(rename.status, 200, await rename.text());

    for (const [route, type, payload] of [
      ["delete-from", SESSION_COMMAND.MESSAGE_DELETE_FROM, { anchor: { turnScopeId: "turn-x" } }],
      [
        "replace-turn",
        SESSION_COMMAND.TURN_REPLACE,
        {
          anchor: { turnScopeId: "turn-x" },
          newContent: "edited",
          turnScopeId: "turn-new",
          attachments: [],
        },
      ],
    ]) {
      await assertScopeAccepted(
        await fetch(`${sessionUrl}/messages/${route}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionCommandBody(type, payload)),
        }),
      );
    }
  });
});

for (const replace of [false, true]) {
  const route = replace ? "replace-turn" : "delete-from";
  const type = replace ? SESSION_COMMAND.TURN_REPLACE : SESSION_COMMAND.MESSAGE_DELETE_FROM;
  const requireResponse = replace ? requireTurnReplaceResponse : requireMessageDeleteResponse;

  test(`session-routes: ${route} 真实存储提交及后续写入后的重放保持增量协议`, async () => {
    await withRealFacadeServer(async ({ baseUrl, session }) => {
      const identity = { userId: USER_ID, sessionId: SESSION_ID, persistenceScope: null };
      const turn = (id) => ({
        role: "user",
        messageOrigin: "natural",
        messageUid: `message-${id}`,
        userMessageId: `um-${id}`,
        content: id,
        dialogProcessId: `dialog-${id}`,
        turnScopeId: id,
        attachments: [],
        transferEnvelopes: [],
      });
      await session.appendTurns({ ...identity, turns: [turn("keep"), turn("remove")] });
      const command = sessionCommandBody(type, {
        anchor: { turnScopeId: "remove" },
        ...(replace ? { newContent: "edited", turnScopeId: "replacement", attachments: [] } : {}),
      });
      const url = `${baseUrl}/internal/session/${USER_ID}/${SESSION_ID}/messages/${route}`;
      async function mutate() {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
        });
        const { ok, ...body } = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        assert.equal(ok, true);
        return requireResponse(body);
      }
      const committed = await mutate();
      assert.equal(committed.deduplicated, false);
      assert.equal(committed.sessionId, SESSION_ID);
      assert.equal(committed.committedAggregateVersion, 1);
      assert.deepEqual(committed.deletedMessageUids, ["message-remove"]);
      assert.equal(Object.hasOwn(committed, "detail"), false);
      assert.equal(committed.projection.messages.length, replace ? 1 : 0);

      await session.appendTurns({ ...identity, turns: [turn("later")] });
      const before = await session.getSessionDisplayData({
        userId: USER_ID,
        sessionId: SESSION_ID,
      });
      const replay = await mutate();
      assert.equal(replay.deduplicated, true);
      assert.equal(replay.committedAggregateVersion, committed.committedAggregateVersion);
      assert.ok(replay.generation > committed.generation);
      assert.deepEqual(replay.projection, committed.projection);
      assert.deepEqual(replay.displayMessages, committed.displayMessages);
      const after = await session.getSessionDisplayData({ userId: USER_ID, sessionId: SESSION_ID });
      assert.deepEqual(after, before);
      const main = after.sessions.find((entry) => entry.sessionId === SESSION_ID);
      assert.equal(main.generation, replay.generation);
      assert.deepEqual(
        main.messages.map((message) => message.content),
        replace ? ["keep", "edited", "later"] : ["keep", "later"],
      );
    });
  });
}
