/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  createTestSessionServices,
  provisionTestSession,
  submitTestSessionRequest,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { migrateSessionImmutableStorage } from "../../src/workspace-lifecycle/session-immutable-storage-upgrade.js";
import { createPluginArtifactCommitRequest } from "@noobot/event-protocol/plugin-artifact-event";

const ts = "2026-01-01T00:00:00.000Z";

const outboxIdentity = { userId: "u1", sessionId: "s1", persistenceScope: null };

function artifactRequest(operation = "created", baseRevision = null) {
  return createPluginArtifactCommitRequest({
    pluginId: "example",
    artifactType: "document",
    artifactId: "one",
    sessionId: "s1",
    turnScopeId: "t1",
    data: { text: "result" },
    operation,
    baseRevision,
  });
}

function message(uid) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: "d1",
    parentDialogProcessId: "",
    turnScopeId: "t1",
    role: "user",
    type: "message",
    messageOrigin: "natural",
    content: uid,
    attachments: [],
    transferEnvelopes: [],
    ts,
  };
}

async function fixture(t) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "immutable-repository-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, "u1");
  const runtime = createTestSessionServices({ workspaceRoot }, { now: () => ts });
  const repository = runtime.repositories.sessionRepository;
  await provisionTestSession(runtime, {
    userId: "u1",
    sessionId: "s1",
    caller: SESSION_CALLER.USER,
  });
  const persistenceContext = repository.treePersistenceContext("u1", "s1");
  const scope = await repository.requireSessionScope("u1", "s1", persistenceContext);
  await migrateSessionImmutableStorage({
    storageService: repository.storageService,
    sessionDir: scope.sessionDir,
  });
  return { runtime, repository, persistenceContext, scope, workspaceRoot };
}

async function seedEvents(repository, persistenceContext) {
  for (const event of [
    {
      eventType: "turn.action_accepted",
      phase: "action",
      action: "send",
      presentationMessageId: "p1",
      dialogProcessId: "d1",
      executionId: "agent:t1",
      executionKind: "agent",
      rootExecutionId: "agent:t1",
    },
    { eventType: "turn.processing_started", phase: "processing" },
  ]) {
    await using reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    const result = await submitTestSessionRequest(
      repository,
      "u1",
      "s1",
      await reader.prepareRequest({
        operationId: event.eventType,
        changes: {
          turnTransition: {
            ...event,
            sessionId: "s1",
            turnScopeId: "t1",
            commandId: event.eventType,
            causationId: event.eventType,
          },
        },
        committedAt: ts,
      }),
      persistenceContext,
    );
    assert.equal(result.result.turnTransition.applied, true);
  }
}

export { ts, message, fixture, outboxIdentity, artifactRequest, seedEvents };
