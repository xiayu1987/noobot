/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import { readSessionArtifact } from "../../src/session/session-artifact-store.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-boundary-"));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("session save keeps thinking timing out of messages and projects finish from turnTimings", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-thinking";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-07-08T10:00:10.000Z" },
    );

    await provisionTestSession(runtime, {
      userId,
      sessionId: "S",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const session = await runtime.repositories.sessionRepository.findById(userId, "S", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "S",
      ),
    });
    session.messages = [
      {
        messageUid: "sm_thinking_user",
        sessionId: "S",
        role: "user",
        content: "hello",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
      {
        messageUid: "sm_thinking_assistant_1",
        sessionId: "S",
        role: "assistant",
        presentationMessageId: "pm_fx1",
        modelMessageId: "mm_session_repository_bound_1",
        content: "first assistant chunk",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
      {
        messageUid: "sm_thinking_assistant_2",
        sessionId: "S",
        role: "assistant",
        presentationMessageId: "pm_fx2",
        modelMessageId: "mm_session_repository_bound_2",
        content: "final assistant chunk",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
    ];
    session.turnTimings = [
      {
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
        thinkingFinishedAt: "2026-07-08T10:00:04.000Z",
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(session), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        session.sessionId,
      ),
    });

    const scope = await runtime.repositories.sessionRepository.requireSessionScope(
      userId,
      "S",
      runtime.repositories.sessionRepository.treePersistenceContext(userId, "S"),
    );
    const full = await readSessionArtifact({ sessionDir: scope.sessionDir });
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "S", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "S",
      ),
    });
    const displaySummary = JSON.parse(
      await readFile(path.join(scope.sessionDir, "session-summary.json"), "utf8"),
    );

    for (const message of [...full.messages, ...displaySummary.messages]) {
      assert.equal(Object.hasOwn(message, "thinkingStartedAt"), false);
      assert.equal(Object.hasOwn(message, "thinkingFinishedAt"), false);
    }
    const expectedTiming = [
      {
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
        thinkingFinishedAt: "2026-07-08T10:00:04.000Z",
      },
    ];
    assert.deepEqual(full.turnTimings, expectedTiming);
    assert.deepEqual(displaySummary.turnTimings, expectedTiming);
  });
});

test("session save keeps the model loop round on persisted turn timings", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u-loop-round";
    await initializeUserWorkspace(workspaceRoot, userId);

    const runtime = createTestSessionServices(
      { workspaceRoot },
      { now: () => "2026-07-08T10:00:10.000Z" },
    );

    await provisionTestSession(runtime, {
      userId,
      sessionId: "S",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const session = await runtime.repositories.sessionRepository.findById(userId, "S", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "S",
      ),
    });
    session.messages = [
      {
        messageUid: "sm_round_user",
        sessionId: "S",
        role: "user",
        content: "hello",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
      {
        messageUid: "sm_round_assistant",
        sessionId: "S",
        role: "assistant",
        presentationMessageId: "pm_fx3",
        modelMessageId: "mm_session_repository_bound_3",
        content: "answer",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
    ];
    session.turnTimings = [
      {
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
        thinkingFinishedAt: "2026-07-08T10:00:04.000Z",
        modelLoopRound: 6,
      },
    ];
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(session), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        session.sessionId,
      ),
    });

    const scope = await runtime.repositories.sessionRepository.requireSessionScope(
      userId,
      "S",
      runtime.repositories.sessionRepository.treePersistenceContext(userId, "S"),
    );
    const full = await readSessionArtifact({ sessionDir: scope.sessionDir });
    await runtime.repositories.sessionRepository.ensureSessionDisplaySummary(userId, "S", {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        "S",
      ),
    });
    const displaySummary = JSON.parse(
      await readFile(path.join(scope.sessionDir, "session-summary.json"), "utf8"),
    );

    const fullTiming = (full.turnTimings || []).find((item) => item.turnScopeId === "turn-1");
    assert.equal(fullTiming?.modelLoopRound, 6);
    const summaryTiming = (displaySummary.turnTimings || []).find(
      (item) => item.turnScopeId === "turn-1",
    );
    assert.equal(summaryTiming?.modelLoopRound, 6);
  });
});
