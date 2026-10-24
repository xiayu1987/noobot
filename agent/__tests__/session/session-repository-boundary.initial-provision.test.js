/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import {
  TURN_EVENT,
  TURN_PHASE,
  TURN_STATE,
  createSessionPersistenceScope,
} from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { createSessionFacade } from "../../src/session/index.js";
import {
  createTestSessionServices,
  provisionTestSession,
  withTreeContext,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { createAcceptedAgentExecution } from "../helpers/accepted-run-identity.js";

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
    startedAt: "2026-07-18T00:00:00.000Z",
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

    const persisted = JSON.parse(await readFile(scope.sessionFile, "utf8"));
    assert.equal(persisted.turnLifecycle.activeTurnScopeId, "turn-1");
    assert.equal(persisted.turnLifecycle.turns["turn-1"].state, TURN_STATE.ACTION_REQUESTING);
    assert.equal(persisted.turnLifecycle.sequence, 1);
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

test("connector selection reads only the Session manifest fact", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    await provisionTestSession(runtime, {
      userId: "u1",
      sessionId: "session-1",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await runtime.sessionCrudService.setRootSessionSelectedConnectorIds({
      userId: "u1",
      sessionId: "session-1",
      selectedConnectorIds: ["connector-1"],
    });

    const scope = await repository.requireSessionScope(
      "u1",
      "session-1",
      repository.treePersistenceContext("u1", "session-1"),
    );
    const manifest = JSON.parse(await readFile(scope.sessionFile, "utf8"));
    manifest.turnOrder = [
      {
        turnId: "turn-000001",
        file: "turns/turn-000001.jsonl",
        committedBytes: 10,
        messageOrder: [],
      },
    ];
    await mkdir(path.join(scope.sessionDir, "turns"), { recursive: true });
    await writeFile(path.join(scope.sessionDir, "turns/turn-000001.jsonl"), "invalid\n", "utf8");
    await writeFile(scope.sessionFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    assert.deepEqual(
      await runtime.sessionCrudService.getRootSessionSelectedConnectorIds({
        userId: "u1",
        sessionId: "session-1",
      }),
      ["connector-1"],
    );
    await assert.rejects(
      repository.findById("u1", "session-1", {
        persistenceContext: repository.treePersistenceContext("u1", "session-1"),
      }),
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
    const runtime = createTestSessionServices({ workspaceRoot });
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
    await runtime.sessionTreeService.deleteSessionBranch({ userId: "u1", sessionId: "session-1" });
    const result = await runtime.sessionMessageService.applyTurnLifecycleEvent(
      withTreeContext(runtime, firstSend("revive-command")),
    );
    assert.equal(result.applied, false);
    assert.equal(result.reason, "session_deleted");
    assert.equal(await exists(scope.sessionFile), false);
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
    const originalSave = repository.save.bind(repository);
    repository.save = async (...args) => {
      assert.equal(args[2]?.createOnly, true);
      throw new Error("injected provision save failure");
    };

    await assert.rejects(
      runtime.sessionMessageService.applyTurnLifecycleEvent(
        withTreeContext(runtime, firstSend("failed-command")),
      ),
      /injected provision save failure/,
    );
    repository.save = originalSave;

    assert.equal(await exists(scope.sessionFile), false);
    const summary = await repository.readSessionsSummary("u1");
    assert.equal(
      summary.sessions.some((item) => item.sessionId === "session-1"),
      false,
    );
  });
});

test("summary write failure surfaces and the explicit rebuild repairs the list index", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    const originalUpsert = repository.upsertSessionSummary.bind(repository);
    repository.upsertSessionSummary = async () => {
      throw new Error("injected summary failure");
    };

    await assert.rejects(
      runtime.sessionMessageService.applyTurnLifecycleEvent(
        withTreeContext(runtime, firstSend("summary-repair")),
      ),
      /injected summary failure/,
    );
    repository.upsertSessionSummary = originalUpsert;
    const persisted = await repository.findById("u1", "session-1", {
      persistenceContext: repository.treePersistenceContext("u1", "session-1"),
    });
    assert.equal(persisted.turnLifecycle.sequence, 1);
    const stale = await repository.readSessionsSummary("u1");
    assert.equal(
      stale.sessions.some((item) => item.sessionId === "session-1"),
      false,
    );
    const summary = await repository.rebuildSessionsSummary("u1");
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

test("appendTurns cannot implicitly create a missing Session", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createTestSessionServices({ workspaceRoot });
    const scope = await runtime.sessionPathResolver.placeSessionScope("u1", {
      sessionId: "session-1",
      parentSessionId: "",
    });
    const result = await createSessionFacade(runtime).appendTurns({
      userId: "u1",
      sessionId: "session-1",
      persistenceScope: null,
      turns: [{ role: "user", content: "must be provisioned first", turnScopeId: "turn-1" }],
    });
    assert.deepEqual(result, { appended: false, reason: "session_not_found", turns: [] });
    assert.equal(await exists(scope.sessionFile), false);
  });
});

test("getSessionTurns reads from the same scoped persistence location used by appendTurns", async () => {
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
          role: "assistant",
          presentationMessageId: "pm_fx1",
          messageUid: "sm-child-1",
          modelMessageId: "msg-child-1",
          dialogProcessId: "dialog-child-1",
          turnScopeId: "turn-child-1",
          content: "child model response",
          activityTimeline: [
            {
              eventId: "model-content:msg-child-1",
              activityKind: "model-content",
              sequence: 1,
              sequenceDomain: "message-event",
              sequenceScopeId: "msg-child-1",
              authority: "authoritative",
            },
          ],
        },
      ],
    });

    const scopedTurns = await session.getSessionTurns({
      userId: "u1",
      sessionId: "child-session-1",
      persistenceScope,
    });
    assert.equal(scopedTurns.length, 1);
    assert.equal(scopedTurns[0]?.messageUid, "sm-child-1");
    assert.equal(scopedTurns[0]?.activityTimeline?.[0]?.eventId, "model-content:msg-child-1");

    const defaultScopeTurns = await session.getSessionTurns({
      userId: "u1",
      sessionId: "child-session-1",
      persistenceScope: null,
    });
    assert.deepEqual(defaultScopeTurns, []);
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
