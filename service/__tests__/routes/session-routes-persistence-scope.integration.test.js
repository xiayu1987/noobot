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
import { createSessionCommand, SESSION_COMMAND } from "@noobot/session-protocol";
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
        summaryError: new Error("summary unavailable"),
      }),
    });

    const report = await fetch(`${sessionUrl}/execution-report?dialogProcessId=dp-1`);
    const reportBody = await report.json();
    assert.equal(report.status, 200, JSON.stringify(reportBody));
    assert.equal(reportBody.report.dialogProcessId, "dp-1");

    const repair = await fetch(`${sessionUrl}/repair`, { method: "POST" });
    assert.equal(repair.status, 200, await repair.text());

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
        { anchor: { turnScopeId: "turn-x" }, newContent: "edited", turnScopeId: "turn-new" },
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
