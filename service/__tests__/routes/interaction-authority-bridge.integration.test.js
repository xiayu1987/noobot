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
import { AUTHORITY_EVENT_CONSUMER } from "../../ws/chat-websocket/authority-event-dispatcher.js";
import { createInteractionAuthorityBridge } from "../../ws/chat-websocket/interaction-authority-bridge.js";
import { initializeUserRuntimeDirectories } from "../runtime-events-root.test-helpers.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

async function withTempWorkspace(operation) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-interaction-authority-"));
  try {
    await initializeUserRuntimeDirectories(workspaceRoot, "user-1");
    return await operation(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("child interaction authority commits through the protocol persistence scope", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createSessionServices(
      { workspaceRoot },
      { attachmentService: new AttachmentService({ workspaceRoot }) },
    );
    const session = createSessionFacade(runtime);
    const persistenceScope = Object.freeze({
      scopeId: "agent:internal-turn:child-turn",
      parentSessionId: "root-session",
      relativeDir: "runtime/agent/session/child-session",
      allowedRoot: "runtime/agent/session",
    });
    await session.createSession({
      userId: "user-1",
      sessionId: "root-session",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
      persistenceScope: null,
    });
    await session.createSession({
      userId: "user-1",
      sessionId: "child-session",
      parentSessionId: "root-session",
      caller: SESSION_CALLER.USER,
      persistenceScope,
    });

    const dispatched = [];
    const commitInteractionRequest = createInteractionAuthorityBridge({
      resolveBot: () => session,
      async dispatchAuthorityEvents(identity) {
        dispatched.push(identity);
        return { dispatched: true };
      },
    });
    const envelope = await commitInteractionRequest({
      userId: "user-1",
      persistenceScope,
      payload: {
        interactionId: "interaction-child-1",
        requestId: "request-child-1",
        content: "provide the required field",
        fields: [],
        dialogProcessId: "dialog-child-1",
        sessionId: "child-session",
        turnScopeId: "internal-turn:child-turn",
        toolName: "user_interaction",
        lifecycle: "pending",
        ackMode: "manual",
      },
    });

    assert.equal(envelope.identity.sessionId, "child-session");
    assert.equal(envelope.identity.turnScopeId, "internal-turn:child-turn");
    assert.deepEqual(dispatched, [
      {
        userId: "user-1",
        sessionId: "child-session",
        persistenceScope,
      },
    ]);
    const pending = await session.getPendingAuthorityEvents({
      userId: "user-1",
      sessionId: "child-session",
      persistenceScope,
      consumerId: AUTHORITY_EVENT_CONSUMER.WEBSOCKET,
    });
    assert.equal(pending.found, true);
    assert.equal(pending.events.length, 1);
    assert.equal(pending.events[0].envelope.identity.eventId, envelope.identity.eventId);
  });
});
