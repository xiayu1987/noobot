/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createTestSessionExecutionEngine } from "../helpers/session-execution-engine.js";
import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { createSessionFacade } from "../../src/session/index.js";
import { migrateSessionImmutableStorage } from "../../src/workspace-lifecycle/session-immutable-storage-upgrade.js";
import { bindCurrentTurnPersistence } from "../../src/bot/execution/runner/current-turn-persistence.js";
import { createCurrentTurnMessagesStore } from "../../src/runtime/turn/current-turn-ledger.js";

const identity = { userId: "u1", sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" };

test("engine persistence carries acknowledged versions through metadata, append and replacement commits", async (t) => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "engine-message-deltas-"));
  t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  await initializeUserWorkspace(workspaceRoot, identity.userId);
  const services = createTestSessionServices({ workspaceRoot });
  await provisionTestSession(services, { ...identity, caller: SESSION_CALLER.USER });
  const repository = services.repositories.sessionRepository;
  const persistenceContext = repository.treePersistenceContext(identity.userId, identity.sessionId);
  const scope = await repository.requireSessionScope(
    identity.userId,
    identity.sessionId,
    persistenceContext,
  );
  await migrateSessionImmutableStorage({
    storageService: repository.storageService,
    sessionDir: scope.sessionDir,
  });
  const session = createSessionFacade(services);
  const engine = createTestSessionExecutionEngine({ session });
  const commits = [];
  const withSessionReader = repository.withSessionReader.bind(repository);
  t.mock.method(repository, "withSessionReader", (userId, sessionId, run, options) =>
    withSessionReader(
      userId,
      sessionId,
      (reader, scope, commit) =>
        run(reader, scope, (request) => {
          commits.push(request);
          return commit(request);
        }),
      options,
    ),
  );
  t.mock.method(repository, "commitChanges", () => {
    assert.fail("A scoped message commit must not reopen the repository");
  });
  const store = createCurrentTurnMessagesStore([
    {
      messageUid: "m1",
      modelMessageId: "model-m1",
      presentationMessageId: "presentation-t1",
      role: "assistant",
      sessionId: identity.sessionId,
      dialogProcessId: identity.dialogProcessId,
      turnScopeId: identity.turnScopeId,
      chatPresentation: true,
      workspaceRootDirectory: "/workspace",
      content: "initial",
    },
  ]);
  const runtime = { currentTurnMessages: store };
  bindCurrentTurnPersistence({
    ...identity,
    persistenceScope: null,
    dispatchRuntime: runtime,
    appendAgentMessages: engine.runner.appendAgentMessages,
  });
  await runtime.persistCurrentTurnMessages();
  const modelResponseMetadata = {
    output: [{ type: "reasoning", id: "reasoning-1", encrypted_content: "opaque" }],
  };
  store.updateByUid("m1", { modelResponseMetadata });
  await runtime.persistCurrentTurnMessages();
  assert.equal(
    commits[1].changes.messages.length,
    0,
    "metadata must not resubmit the full message",
  );
  assert.deepEqual(commits[1].changes.messageMetadataUpdates[0].metadata, {
    modelResponseMetadata,
  });
  const metadataVersion = commits[1].changes.messageMetadataUpdates[0].expectedContentReference;
  store.appendContentByUid("m1", " fragment");
  await runtime.persistCurrentTurnMessages();
  assert.equal(commits[2].changes.messages.length, 0);
  assert.deepEqual(commits[2].changes.messageContentAppends, [
    {
      messageUid: "m1",
      dialogProcessId: "d1",
      turnScopeId: "t1",
      expectedContentReference: metadataVersion,
      content: " fragment",
    },
  ]);
  store.updateByUid("m1", { content: "explicit replacement" });
  await runtime.persistCurrentTurnMessages();
  assert.equal(commits[3].changes.messages[0].content, "explicit replacement");
  assert.equal(commits[3].changes.messageContentAppends.length, 0);
  assert.equal(store.demoteAssistantPresentation(identity.turnScopeId), 1);
  await runtime.persistCurrentTurnMessages();
  assert.equal(commits[4].changes.messages.length, 0);
  assert.deepEqual(commits[4].changes.messageMetadataUpdates[0].metadata, {
    chatPresentation: false,
  });
  assert.deepEqual(commits[4].changes.messageMetadataUpdates[0].metadataRemovals, [
    "workspaceRootDirectory",
  ]);
  await using reader = await repository.requireSessionReader(identity.userId, identity.sessionId, {
    persistenceContext,
  });
  const { message } = await reader.readMessage("m1");
  assert.equal(message.content, "explicit replacement");
  assert.deepEqual(message.modelResponseMetadata, modelResponseMetadata);
  assert.equal(message.chatPresentation, false);
  assert.equal(Object.hasOwn(message, "workspaceRootDirectory"), false);
  assert.equal(store.readPendingChanges().entries.length, 0);
});
