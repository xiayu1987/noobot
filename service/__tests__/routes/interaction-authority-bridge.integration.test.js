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
import { createInteractionAuthorityBridge } from "../../ws/chat-websocket/interaction-authority-bridge.js";

async function withTempWorkspace(operation) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-interaction-authority-"));
  try {
    return await operation(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("child interaction authority commits through the protocol persistence scope", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createSessionServices({ workspaceRoot });
    const session = createSessionFacade(runtime);
    const persistenceScope = Object.freeze({
      scopeId: "agent:internal-turn:child-turn",
      parentSessionId: "root-session",
      relativeDir: "runtime/agent/session/child-session",
      allowedRoot: "runtime/agent/session",
    });
    await runtime.sessionCrudService.ensureSession("user-1", "root-session", "", {});
    const childPersistenceContext = runtime.createScopedPersistenceContext({
      userId: "user-1",
      sessionId: "child-session",
      parentSessionId: persistenceScope.parentSessionId,
      scopeId: persistenceScope.scopeId,
      relativeDir: persistenceScope.relativeDir,
      allowedRoot: persistenceScope.allowedRoot,
    });
    await runtime.sessionCrudService.ensureSession(
      "user-1",
      "child-session",
      "root-session",
      {},
      childPersistenceContext,
    );

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
      parentSessionId: "root-session",
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
        parentSessionId: "root-session",
        persistenceScope,
      },
    ]);
    const pending = await session.getPendingAuthorityEvents({
      userId: "user-1",
      sessionId: "child-session",
      parentSessionId: "root-session",
      persistenceScope,
    });
    assert.equal(pending.found, true);
    assert.equal(pending.events.length, 1);
    assert.equal(pending.events[0].envelope.identity.eventId, envelope.identity.eventId);
  });
});
