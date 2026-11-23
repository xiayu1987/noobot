/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rename, rm } from "node:fs/promises";
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
import { setFsAdapter, resetFsAdapter } from "../../src/shared/storage/fs-adapter.js";

const identity = { userId: "u1", sessionId: "s1", dialogProcessId: "d1", turnScopeId: "t1" };

for (const failure of ["before publication", "after publication", "lost response"]) {
  test(`message append resumes its frozen submission after ${failure}`, async (t) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "engine-message-retry-"));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    t.after(resetFsAdapter);
    await initializeUserWorkspace(workspaceRoot, identity.userId);
    const services = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(services, { ...identity, caller: SESSION_CALLER.USER });
    const repository = services.repositories.sessionRepository;
    const persistenceContext = repository.treePersistenceContext(
      identity.userId,
      identity.sessionId,
    );
    const scope = await repository.requireSessionScope(
      identity.userId,
      identity.sessionId,
      persistenceContext,
    );
    await migrateSessionImmutableStorage({
      storageService: repository.storageService,
      sessionDir: scope.sessionDir,
    });
    const engine = createTestSessionExecutionEngine({ session: createSessionFacade(services) });
    const store = createCurrentTurnMessagesStore([
      {
        messageUid: "m1",
        modelMessageId: "model-m1",
        presentationMessageId: "presentation-t1",
        role: "assistant",
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
    const commits = [];
    const outcomes = [];
    const withSessionCommit = repository.withSessionCommit.bind(repository);
    let armed = true;
    t.mock.method(repository, "withSessionCommit", (userId, sessionId, run, options) =>
      withSessionCommit(
        userId,
        sessionId,
        ({ commitChanges, ...capabilities }) =>
          run({
            ...capabilities,
            commitChanges: async (request) => {
              commits.push(request);
              const result = await commitChanges(request);
              outcomes.push(result);
              if (failure === "lost response" && armed) {
                armed = false;
                throw new Error("injected response loss");
              }
              return result;
            },
          }),
        options,
      ),
    );
    if (failure !== "lost response") {
      setFsAdapter({
        rename: async (source, target) => {
          if (String(target) !== path.join(scope.sessionDir, "head.json") || !armed)
            return rename(source, target);
          armed = false;
          if (failure === "after publication") await rename(source, target);
          throw Object.assign(new Error("injected head publication failure"), { code: "EIO" });
        },
      });
    }
    store.appendContentByUid("m1", " first");
    await assert.rejects(
      runtime.persistCurrentTurnMessages(),
      failure === "lost response" ? /response loss/ : { code: "SESSION_COMMIT_UNCERTAIN" },
    );
    resetFsAdapter();
    assert.equal(armed, false, "the intended publication boundary must be reached");
    const published = failure !== "before publication";
    {
      await using reader = await repository.requireSessionReader(
        identity.userId,
        identity.sessionId,
        { persistenceContext },
      );
      assert.equal(reader.generation, commits[0].expectedGeneration + Number(published));
      assert.equal(
        (await reader.readMessage("m1")).message.content,
        published ? "initial first" : "initial",
      );
    }
    store.appendContentByUid("m1", " concurrent");
    await runtime.persistCurrentTurnMessages();
    assert.equal(commits.length, 3);
    assert.deepEqual(
      commits[1],
      commits[0],
      "the complete commit request must survive failure unchanged",
    );
    assert.equal(commits[0].input.changes.messageContentAppends[0].content, " first");
    const [retried, next] = outcomes.slice(-2);
    assert.equal(retried.replayed, published);
    assert.equal(retried.generation, commits[0].expectedGeneration + 1);
    if (failure === "lost response") assert.deepEqual(retried, { ...outcomes[0], replayed: true });
    assert.equal(next.replayed, false);
    assert.equal(next.generation, retried.generation + 1);
    assert.notEqual(commits[2].operationId, commits[0].operationId);
    assert.equal(commits[2].expectedGeneration, commits[0].expectedGeneration + 1);
    assert.equal(commits[2].input.changes.messageContentAppends[0].content, " concurrent");
    await using reader = await repository.requireSessionReader(
      identity.userId,
      identity.sessionId,
      { persistenceContext },
    );
    assert.equal(reader.generation, commits[0].expectedGeneration + 2);
    assert.equal((await reader.readMessage("m1")).message.content, "initial first concurrent");
    assert.equal(store.readPendingChanges().entries.length, 0);
    await runtime.persistCurrentTurnMessages();
    assert.equal(commits.length, 3, "another flush must not resubmit acknowledged revisions");
  });
}
