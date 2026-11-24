/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, rm } from "node:fs/promises";
import { PARTITION_MESSAGE_COLLECTIONS } from "@noobot/session-protocol/partition-session-messages";
import { PartitionTransactions } from "../../src/session/partition-storage/partition-transactions.js";
import { partitionReaderAccess } from "../helpers/partition-reader-fixture.js";

import {
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
  createSessionPersistenceScope,
} from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createSessionFacade } from "../../src/session/index.js";
import {
  executeEmptySessionCleanup,
  createTestPartitionSessionServices,
  createTestSessionServices,
  provisionTestSession,
  withTreeContext,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";
import { canonicalActivity } from "./session-repository-boundary.summaries.fixtures.js";

async function withTempWorkspace(operation) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-initial-provision-"));
  try {
    await initializeUserWorkspace(workspaceRoot, "u1");
    return await operation(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function firstSend(commandId, turnScopeId = "turn-1") {
  return {
    userId: "u1",
    sessionId: "session-1",
    parentSessionId: "",
    turnScopeId,
    presentationMessageId: `presentation-${turnScopeId}`,
    commandId,
    causationId: commandId,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    ...createAcceptedAgentExecution(turnScopeId, "session-1"),
    userMessage: {
      content: "persist me before execution",
      userMessageId: `um_${turnScopeId}`,
      messageOrigin: "natural",
    },
    expectedRevision: 0,
    createSessionIfAbsent: true,
    sessionCaller: SESSION_CALLER.USER,
  };
}

test("file repository provisions Session and initial Turn in one persisted artifact", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-07-19T00:00:00.000Z" },
    );
    const scope = await runtime.repositories.sessionRepository.placeSessionScope(
      "u1",
      { sessionId: "session-1", parentSessionId: "" },
      runtime.repositories.sessionRepository.treePersistenceContext("u1", "session-1"),
    );
    assert.equal(await exists(scope.sessionFile), false);

    const result = await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, firstSend("command-1")),
    );
    assert.equal(result.applied, true);
    assert.equal(result.sessionCreated, true);

    assert.equal(await exists(scope.sessionFile), false);
    await using reader = await runtime.repositories.sessionRepository.requireSessionReader(
      "u1",
      "session-1",
      {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          "u1",
          "session-1",
        ),
      },
    );
    assert.equal(reader.generation, 1);
    assert.equal((await reader.readLifecycleHead()).activeTurnScopeId, "turn-1");
    assert.equal((await reader.readTurnState("turn-1")).state, TURN_STATE.ACTION_REQUESTING);
    assert.equal((await reader.readLifecycleHead()).sequence, 1);
    const pending = await reader.readOutboxPage({ consumerId: "test-consumer" });
    assert.equal(pending.hasMore, false);
    assert.equal(pending.events.length, 1);
    assert.equal(pending.events[0].eventId, result.committedEvent.eventId);
    const receipt = await reader.readCommand("command-1");
    assert.equal(receipt.eventId, pending.events[0].eventId);
    const persistedSession = await runtime.repositories.sessionRepository.findById(
      "u1",
      "session-1",
      {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          "u1",
          "session-1",
        ),
      },
    );
    assert.equal(persistedSession.messages.length, 1);
    assert.equal(persistedSession.messages[0].content, "persist me before execution");
    assert.equal(persistedSession.messages[0].turnScopeId, "turn-1");
    assert.equal(persistedSession.aggregateVersion, 1);
    assert.equal(result.aggregateVersion, 1);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary("u1");
    assert.equal(summary.sessions.filter((item) => item.sessionId === "session-1").length, 1);
  });
});

function rejectMessageCollectionReads(operation) {
  return (read) =>
    operation(
      Object.assign((query) => {
        assert.notEqual(query.collection, PARTITION_MESSAGE_COLLECTIONS.messages);
        assert.notEqual(query.collection, PARTITION_MESSAGE_COLLECTIONS.content);
        return read(query);
      }, read),
    );
}

test("connector selection does not read partition message records or bodies", async (t) => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, firstSend("connector-message")),
    );
    await runtime.sessionCrudService.setRootSessionSelectedConnectorIds({
      userId: "u1",
      sessionId: "session-1",
      selectedConnectorIds: ["connector-1"],
    });

    const original = PartitionTransactions.prototype.withCollectionReader;
    t.mock.method(
      PartitionTransactions.prototype,
      "withCollectionReader",
      function (snapshot, operation, options) {
        return original.call(this, snapshot, rejectMessageCollectionReads(operation), options);
      },
    );

    assert.deepEqual(
      await runtime.sessionCrudService.getRootSessionSelectedConnectorIds({
        userId: "u1",
        sessionId: "session-1",
      }),
      ["connector-1"],
    );
  });
});

test("initial acceptance allocates one stable dialog identity before persistence", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const input = firstSend("dialog-allocation");
    delete input.dialogProcessId;
    const accepted = await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, input),
    );
    const replay = await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, input),
    );
    assert.equal(Boolean(accepted.dialogProcessId), true);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.dialogProcessId, accepted.dialogProcessId);
    assert.equal(replay.userMessage.dialogProcessId, accepted.dialogProcessId);
  });
});

test("shared file mutation lock makes concurrent initial provisions idempotent and exclusive", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const firstRuntime = createTestSessionServices({ workspaceRoot });
    const secondRuntime = createTestSessionServices({ workspaceRoot });
    const same = firstSend("same-command");
    const [first, replay] = await Promise.all([
      firstRuntime.sessionMessageService.applyTurnLifecycleEvent(
        withTreeContext(firstRuntime, same),
      ),
      secondRuntime.sessionMessageService.applyTurnLifecycleEvent(
        withTreeContext(secondRuntime, same),
      ),
    ]);
    assert.equal([first, replay].filter((result) => result.applied).length, 1);
    assert.equal([first, replay].filter((result) => result.deduplicated).length, 1);

    const competing = await secondRuntime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(secondRuntime, firstSend("competing-command", "turn-2")),
    );
    assert.equal(competing.reason, "session_action_conflict");
    const persisted = await firstRuntime.repositories.sessionRepository.findById(
      "u1",
      "session-1",
      {
        persistenceContext: firstRuntime.repositories.sessionRepository.treePersistenceContext(
          "u1",
          "session-1",
        ),
      },
    );
    assert.equal(persisted.turnLifecycle.sequence, 1);
    assert.equal(persisted.turnLifecycle.activeTurnScopeId, "turn-1");
  });
});

test("deleted Session cannot be revived by initial provision", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await using runtime = createTestPartitionSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId: "u1",
      sessionId: "session-1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const scope = await runtime.repositories.sessionRepository.requireSessionScope(
      "u1",
      "session-1",
      runtime.repositories.sessionRepository.treePersistenceContext("u1", "session-1"),
    );
    await runtime.sessionTreeService.deleteSessionBranch(
      {
        userId: "u1",
        sessionIds: ["session-1"],
      },
      executeEmptySessionCleanup,
    );
    const result = await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, firstSend("revive-command")),
    );
    assert.equal(result.applied, false);
    assert.equal(result.reason, "session_deleted");
    assert.equal(await exists(scope.sessionDir), false);
  });
});

test("failed initial provision save leaves no empty Session artifact or summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    const scope = await repository.placeSessionScope(
      "u1",
      { sessionId: "session-1", parentSessionId: "" },
      repository.treePersistenceContext("u1", "session-1"),
    );
    const originalCreate = repository.createStoredSession.bind(repository);
    repository.createStoredSession = async (...args) => {
      assert.equal(args[1].aggregateVersion, 0);
      assert.equal(args[1].messages.length, 0);
      assert.equal(args[1].turnLifecycle.sequence, 0);
      assert.equal(args[2].initialTurn.changes.messages.length, 1);
      assert.equal(Object.hasOwn(args[2], "authorityEvents"), false);
      throw new Error("injected provision save failure");
    };

    await assert.rejects(
      runtime.sessionMessageService.applyTurnLifecycleEvent(
        withTreeContext(runtime, firstSend("failed-command")),
      ),
      /injected provision save failure/,
    );
    repository.createStoredSession = originalCreate;

    assert.equal(await exists(scope.sessionFile), false);
    assert.equal(await exists(path.join(scope.sessionDir, "head.json")), false);
    const summary = await repository.readSessionsSummary("u1");
    assert.equal(
      summary.sessions.some((item) => item.sessionId === "session-1"),
      false,
    );
  });
});

test("initial provision publishes list membership without a separate summary transaction", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, firstSend("summary-repair")),
    );
    const persisted = await repository.findById("u1", "session-1", {
      persistenceContext: repository.treePersistenceContext("u1", "session-1"),
    });
    assert.equal(persisted.turnLifecycle.sequence, 1);
    const summary = await repository.readSessionsSummary("u1");
    assert.equal(summary.sessions.filter((item) => item.sessionId === "session-1").length, 1);

    const replay = await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, firstSend("summary-repair")),
    );
    assert.equal(replay.deduplicated, true);
    assert.equal(
      (
        await repository.findById("u1", "session-1", {
          persistenceContext: repository.treePersistenceContext("u1", "session-1"),
        })
      ).turnLifecycle.sequence,
      1,
    );
  });
});

test("initial provision retry registers an already committed head without repeating its effects", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    const persistenceContext = repository.treePersistenceContext("u1", "session-1");
    const scope = await repository.placeSessionScope(
      "u1",
      { sessionId: "session-1", parentSessionId: "" },
      persistenceContext,
    );
    repository.commitSessionPlacement = async () => {
      throw new Error("injected placement failure after head publication");
    };
    await assert.rejects(
      runtime.sessionMessageService.applyTurnLifecycleEvent(
        withTreeContext(runtime, firstSend("placement-retry")),
      ),
      /injected placement failure/,
    );
    let original;
    {
      await using committed = await partitionReaderAccess.openArtifact(scope);
      assert.equal(committed.generation, 1);
      [original] = (await committed.exportSession()).messages;
    }
    const restarted = createTestSessionServices({ workspaceRoot });
    const replay = await restarted.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(restarted, firstSend("placement-retry")),
    );
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.userMessage.messageUid, original.messageUid);
    await using reader = await restarted.repositories.sessionRepository.requireSessionReader(
      "u1",
      "session-1",
      {
        persistenceContext: restarted.repositories.sessionRepository.treePersistenceContext(
          "u1",
          "session-1",
        ),
      },
    );
    assert.equal(reader.generation, 1);
    assert.equal((await reader.exportSession()).messages.length, 1);
    const pending = await reader.readOutboxPage({ consumerId: "test-consumer" });
    assert.equal(pending.events.length, 1);
    assert.equal(pending.hasMore, false);
    const summary = await restarted.repositories.sessionRepository.readSessionsSummary("u1");
    assert.equal(summary.sessions.filter((item) => item.sessionId === "session-1").length, 1);
  });
});

test("explicit creation retry registers the committed empty session after placement failure", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    runtime.repositories.sessionRepository.commitSessionPlacement = async () => {
      throw new Error("injected empty placement failure");
    };
    const request = {
      userId: "u1",
      sessionId: "session-1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    };
    await assert.rejects(
      provisionTestSession(runtime, request),
      /injected empty placement failure/,
    );
    const restarted = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(restarted, request);
    await using reader = await restarted.repositories.sessionRepository.requireSessionReader(
      "u1",
      "session-1",
      {
        persistenceContext: restarted.repositories.sessionRepository.treePersistenceContext(
          "u1",
          "session-1",
        ),
      },
    );
    assert.equal(reader.generation, 1);
    assert.equal((await reader.exportSession()).messages.length, 0);
  });
});

test("appendTurns cannot implicitly create a missing Session", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const scope = await runtime.sessionPathResolver.placeSessionScope("u1", {
      sessionId: "session-1",
      parentSessionId: "",
    });
    await assert.rejects(
      createSessionFacade(runtime).appendTurns({
        userId: "u1",
        sessionId: "session-1",
        persistenceScope: null,
        turns: [
          {
            attachments: [],
            transferEnvelopes: [],
            role: "user",
            content: "must be provisioned first",
            turnScopeId: "turn-1",
          },
        ],
      }),
      { code: "SESSION_NOT_FOUND" },
    );
    assert.equal(await exists(scope.sessionFile), false);
  });
});

test("turn message pages use the same scoped persistence location as appendTurns", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const session = createSessionFacade(runtime);
    const persistenceScope = createSessionPersistenceScope({
      scopeId: "agent:node-1",
      parentSessionId: "parent-session-1",
      relativeDir: "runtime/plugin-data/workflow/session/run-1/node-1",
      allowedRoot: "runtime/plugin-data/workflow/session",
    });
    await session.createSession({
      userId: "u1",
      sessionId: "child-session-1",
      parentSessionId: "parent-session-1",
      caller: SESSION_CALLER.USER,
      persistenceScope,
    });
    await session.appendTurns({
      userId: "u1",
      sessionId: "child-session-1",
      persistenceScope,
      turns: [
        {
          attachments: [],
          transferEnvelopes: [],
          role: "assistant",
          presentationMessageId: "pm_fx1",
          messageUid: "sm-child-1",
          modelMessageId: "msg-child-1",
          dialogProcessId: "dialog-child-1",
          turnScopeId: "turn-child-1",
          content: "child model response",
          activityTimeline: [
            canonicalActivity({
              eventId: "model-content:msg-child-1",
              sequenceScopeId: "msg-child-1",
              sessionId: "child-session-1",
              dialogProcessId: "dialog-child-1",
              turnScopeId: "turn-child-1",
              presentationMessageId: "pm_fx1",
            }),
          ],
        },
      ],
    });

    const query = {
      userId: "u1",
      sessionId: "child-session-1",
      dialogProcessId: "dialog-child-1",
      turnScopeId: "turn-child-1",
      cursor: null,
      limit: 1,
    };
    const page = await session.getSessionTurnMessagePage({
      ...query,
      persistenceScope,
    });
    assert.equal(page.records.length, 1);
    assert.equal(page.records[0].message.messageUid, "sm-child-1");
    assert.equal(page.records[0].message.activityTimeline[0].eventId, "model-content:msg-child-1");
    assert.equal(page.nextCursor, null);

    await assert.rejects(
      session.getSessionTurnMessagePage({
        ...query,
        persistenceScope: null,
      }),
      (error) => error?.code === "SESSION_NOT_FOUND" && error?.statusCode === 404,
    );
  });
});

test("session tree placement rejects a parent that is not registered in the session tree", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    await assert.rejects(
      () =>
        runtime.sessionPathResolver.commitSessionPlacement("u1", {
          sessionId: "child",
          parentSessionId: "ghost",
          caller: SESSION_CALLER.BOT,
        }),
      (error) =>
        error.code === "FATAL_PARENT_SESSION_MISSING" &&
        error.details.protocolCode === "SESSION_TREE_PARENT_MISSING",
    );
    const tree = await runtime.repositories.sessionTreeRepository.getTree("u1");
    assert.equal(Object.hasOwn(tree.nodes, "child"), false);
  });
});
