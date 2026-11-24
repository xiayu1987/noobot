/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { partitionReaderAccess } from "../../../agent/__tests__/helpers/partition-reader-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createSessionFacade, createSessionServices } from "noobot-agent/session";
import { AttachmentService } from "noobot-agent/attach";
import { resolveScopedSessionRoots } from "@noobot/workspace-protocol";
import { AGENT_TRANSPORT_EVENT } from "@noobot/agent-transport-protocol";
import {
  callChatWs,
  closeServer,
  createAcceptedAgentExecutionIdentity,
  startAuthoritativeServerWithWs,
} from "./chat-websocket-server.test-helpers.js";
import {
  initializeUserRuntimeDirectories,
  withRuntimeEventsRoot,
} from "../runtime-events-root.test-helpers.js";

function openSessionFacade(workspaceRoot) {
  return createSessionFacade(
    createSessionServices(
      { workspaceRoot },
      {
        now: () => new Date().toISOString(),
        sessionReaderAccess: partitionReaderAccess,
        attachmentService: new AttachmentService({ workspaceRoot }),
        scopedSessionRoots: resolveScopedSessionRoots([]),
      },
    ),
  );
}

test("first WebSocket send persists its session and accepted message before Agent execution", () =>
  withRuntimeEventsRoot("noobot-ws-initial-provision-", async (workspaceRoot) => {
    const userId = "first-owner";
    const sessionId = "first-session";
    const turnScopeId = "first-turn";
    const identity = { userId, sessionId, persistenceScope: null };
    await initializeUserRuntimeDirectories(workspaceRoot, userId);
    const session = openSessionFacade(workspaceRoot);
    assert.deepEqual(await session.listSessionIds({ userId }), []);
    let acceptedBundle;
    let runCount = 0;
    const server = await startAuthoritativeServerWithWs({
      resolveAuthByApiKey: () => ({ userId }),
      bot: {
        runWorkspaceOperation: (_userId, operation) => operation(),
        session,
        resolveExecutionIntent: createAcceptedAgentExecutionIdentity,
        async runSession() {
          runCount += 1;
          acceptedBundle = await openSessionFacade(workspaceRoot).getSessionBundle(identity);
          throw Object.assign(new Error("stop after observing durable acceptance"), {
            code: "test_after_durable_acceptance",
          });
        },
      },
    });
    try {
      const events = await callChatWs({
        port: server.address().port,
        timeoutMs: 5000,
        payload: { sessionId, turnScopeId, message: "first persisted input", createIfAbsent: true },
      });
      assert.equal(runCount, 1);
      assert.equal(acceptedBundle.session.sessionId, sessionId);
      assert.equal(acceptedBundle.session.turnLifecycle.activeTurnScopeId, turnScopeId);
      assert.equal(acceptedBundle.session.messages.length, 1);
      assert.equal(acceptedBundle.session.messages[0].content, "first persisted input");
      assert.equal(acceptedBundle.session.messages[0].turnScopeId, turnScopeId);
      assert.equal(events.at(-1).event, AGENT_TRANSPORT_EVENT.COMMAND_RECEIPT);
      assert.equal(events.at(-1).data.error.code, "test_after_durable_acceptance");
      assert.deepEqual(await openSessionFacade(workspaceRoot).listSessionIds({ userId }), [
        sessionId,
      ]);
    } finally {
      await closeServer(server);
    }
  }));
