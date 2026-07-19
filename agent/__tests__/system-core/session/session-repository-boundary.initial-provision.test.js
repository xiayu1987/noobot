/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";

import { TURN_EVENT, TURN_PHASE, TURN_STATE } from "@noobot/shared/turn-lifecycle-protocol";
import { createSessionServices } from "../../../src/system-core/session/index.js";

async function withTempWorkspace(operation) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-initial-provision-"));
  try {
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
    turnScopeId,
    dialogProcessId: "dialog-1",
    commandId,
    eventType: TURN_EVENT.ACTION_ACCEPTED,
    phase: TURN_PHASE.ACTION,
    action: "send",
    expectedRevision: 0,
    createSessionIfAbsent: true,
  };
}

test("file repository provisions Session and initial Turn in one persisted artifact", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createSessionServices({ workspaceRoot }, { now: () => "2026-07-19T00:00:00.000Z" });
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope("u1", "session-1", "");
    assert.equal(await exists(scope.sessionFile), false);

    const result = await runtime.sessionMessageService.applyTurnLifecycleEvent(firstSend("command-1"));
    assert.equal(result.applied, true);
    assert.equal(result.sessionCreated, true);

    const persisted = JSON.parse(await readFile(scope.sessionFile, "utf8"));
    assert.equal(persisted.turnLifecycle.activeTurnScopeId, "turn-1");
    assert.equal(persisted.turnLifecycle.turns["turn-1"].state, TURN_STATE.ACTION_REQUESTING);
    assert.equal(persisted.turnLifecycle.sequence, 1);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary("u1");
    assert.equal(summary.sessions.filter((item) => item.sessionId === "session-1").length, 1);
  });
});

test("shared file mutation lock makes concurrent initial provisions idempotent and exclusive", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const firstRuntime = createSessionServices({ workspaceRoot });
    const secondRuntime = createSessionServices({ workspaceRoot });
    const same = firstSend("same-command");
    const [first, replay] = await Promise.all([
      firstRuntime.sessionMessageService.applyTurnLifecycleEvent(same),
      secondRuntime.sessionMessageService.applyTurnLifecycleEvent(same),
    ]);
    assert.equal([first, replay].filter((result) => result.applied).length, 1);
    assert.equal([first, replay].filter((result) => result.deduplicated).length, 1);

    const competing = await secondRuntime.sessionMessageService.applyTurnLifecycleEvent(
      firstSend("competing-command", "turn-2"),
    );
    assert.equal(competing.reason, "session_action_conflict");
    const persisted = await firstRuntime.repositories.sessionRepository.findById("u1", "session-1", "");
    assert.equal(persisted.turnLifecycle.sequence, 1);
    assert.equal(persisted.turnLifecycle.activeTurnScopeId, "turn-1");
  });
});

test("deleted Session cannot be revived by initial provision", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionCrudService.ensureSession("u1", "session-1");
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope("u1", "session-1", "");
    await runtime.sessionTreeService.deleteSessionBranch({ userId: "u1", sessionId: "session-1" });
    const result = await runtime.sessionMessageService.applyTurnLifecycleEvent(firstSend("revive-command"));
    assert.equal(result.applied, false);
    assert.equal(result.reason, "session_not_found");
    assert.equal(await exists(scope.sessionFile), false);
  });
});

test("failed initial provision save leaves no empty Session artifact or summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    const scope = await repository.resolveSessionScope("u1", "session-1", "");
    const originalSave = repository.save.bind(repository);
    repository.save = async (...args) => {
      assert.equal(args[3]?.createOnly, true);
      throw new Error("injected provision save failure");
    };

    await assert.rejects(
      runtime.sessionMessageService.applyTurnLifecycleEvent(firstSend("failed-command")),
      /injected provision save failure/,
    );
    repository.save = originalSave;

    assert.equal(await exists(scope.sessionFile), false);
    const summary = await repository.readSessionsSummary("u1");
    assert.equal(summary.sessions.some((item) => item.sessionId === "session-1"), false);
  });
});

test("summary write failure is repaired from the committed Session artifact", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createSessionServices({ workspaceRoot });
    const repository = runtime.repositories.sessionRepository;
    const originalUpsert = repository.upsertSessionSummary.bind(repository);
    let failures = 0;
    repository.upsertSessionSummary = async (...args) => {
      if (failures++ === 0) throw new Error("injected summary failure");
      return originalUpsert(...args);
    };

    const result = await runtime.sessionMessageService.applyTurnLifecycleEvent(firstSend("summary-repair"));
    assert.equal(result.applied, true);
    const persisted = await repository.findById("u1", "session-1", "");
    assert.equal(persisted.turnLifecycle.sequence, 1);
    const summary = await repository.readSessionsSummary("u1");
    assert.equal(summary.sessions.filter((item) => item.sessionId === "session-1").length, 1);

    const replay = await runtime.sessionMessageService.applyTurnLifecycleEvent(firstSend("summary-repair"));
    assert.equal(replay.deduplicated, true);
    assert.equal((await repository.findById("u1", "session-1", "")).turnLifecycle.sequence, 1);
  });
});

test("appendTurn cannot implicitly create a missing Session", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const runtime = createSessionServices({ workspaceRoot });
    const scope = await runtime.repositories.sessionRepository.resolveSessionScope("u1", "session-1", "");
    const result = await runtime.sessionMessageService.appendTurn({
      userId: "u1",
      sessionId: "session-1",
      role: "user",
      content: "must be provisioned first",
      turnScopeId: "turn-1",
    });
    assert.deepEqual(result, { appended: false, reason: "session_not_found" });
    assert.equal(await exists(scope.sessionFile), false);
  });
});
