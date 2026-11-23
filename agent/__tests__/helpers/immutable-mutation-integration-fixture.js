/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import {
  createTestSessionServices,
  provisionTestSession,
  submitTestSessionRequest,
} from "./session-services.js";
import { initializeUserWorkspace } from "./user-workspace.js";
import { createTestSessionRequiredFields } from "./session-message-facts.js";
import { registerDialogOrderMessage } from "../../src/session/entities/dialog-order-entity.js";
import { initializeImmutableSession } from "../../src/session/session-artifact-session/immutable-session-bootstrap.js";

export const mutationTime = "2026-06-17T00:00:00.000Z";

export function mutationMessage(uid, scope = uid, fields = {}) {
  return {
    messageUid: uid,
    userMessageId: uid,
    sessionId: "s1",
    parentSessionId: "",
    dialogProcessId: `dialog-${scope}`,
    parentDialogProcessId: "",
    turnScopeId: scope,
    role: "user",
    type: "message",
    messageOrigin: "natural",
    content: uid,
    attachments: [],
    ts: mutationTime,
    ...fields,
  };
}

export async function immutableMutationFixture(t, { messages = [], aggregateVersion = 0 } = {}) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "immutable-mutations-"));
  const readers = [];
  t.after(async () => {
    for (const reader of readers) await reader.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  });
  await initializeUserWorkspace(workspaceRoot, "u1");
  const runtime = createTestSessionServices({ workspaceRoot }, { now: () => mutationTime });
  const repository = runtime.repositories.sessionRepository;
  const persistenceContext = repository.treePersistenceContext("u1", "s1");
  const scope = await repository.placeSessionScope(
    "u1",
    { sessionId: "s1", parentSessionId: "" },
    persistenceContext,
  );
  await initializeImmutableSession({
    sessionDir: scope.sessionDir,
    operationId: "initialize-mutation-test",
    session: {
      ...createTestSessionRequiredFields(),
      sessionId: "s1",
      aggregateVersion,
      messages,
      dialogOrder: messages.reduce(registerDialogOrderMessage, []),
    },
  });
  await provisionTestSession(runtime, {
    userId: "u1",
    sessionId: "s1",
    caller: SESSION_CALLER.USER,
  });
  await writeFile(scope.sessionFile, "legacy manifest must not be read");
  repository.requireById = () => assert.fail("mutations must not export the full session");
  repository.save = () => assert.fail("mutations must not save the full session");
  const request = { userId: "u1", sessionId: "s1", persistenceContext };
  const open = async () => {
    const reader = await repository.requireSessionReader("u1", "s1", { persistenceContext });
    readers.push(reader);
    return reader;
  };
  let sequence = 0;
  const commit = async (changes) => {
    await using reader = await open();
    return await submitTestSessionRequest(
      repository,
      "u1",
      "s1",
      await reader.prepareRequest({
        operationId: `fixture:${++sequence}`,
        committedAt: mutationTime,
        changes,
      }),
      persistenceContext,
    );
  };
  return {
    runtime,
    service: runtime.sessionMessageService,
    repository,
    scope,
    request,
    open,
    commit,
  };
}
