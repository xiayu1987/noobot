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

import {
  createTestSessionServices,
  provisionTestSession,
  commitTestSessionChanges,
} from "../helpers/session-services.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

async function withTempWorkspace(fn) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "noobot-session-boundary-"));
  try {
    return await fn(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

test("message and timing deltas keep thinking timing out of messages and project its finish", async () => {
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
        attachments: [],
        messageUid: "sm_thinking_user",
        ts: TEST_MESSAGE_TS,
        sessionId: "S",
        role: "user",
        messageOrigin: "natural",
        content: "hello",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
      {
        attachments: [],
        messageUid: "sm_thinking_assistant_1",
        ts: TEST_MESSAGE_TS,
        sessionId: "S",
        role: "assistant",
        presentationMessageId: "pm_fx1",
        modelMessageId: "mm_session_repository_bound_1",
        chatPresentation: false,
        content: "first assistant chunk",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
      {
        attachments: [],
        messageUid: "sm_thinking_assistant_2",
        ts: TEST_MESSAGE_TS,
        sessionId: "S",
        role: "assistant",
        presentationMessageId: "pm_fx1",
        modelMessageId: "mm_session_repository_bound_2",
        chatPresentation: true,
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
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: session.sessionId,
      changes: { messages: session.messages, timings: session.turnTimings },
    });

    const repository = runtime.repositories.sessionRepository;
    const context = { persistenceContext: repository.treePersistenceContext(userId, "S") };
    const full = await repository.requireById(userId, "S", context);
    const displaySummary = await repository.readSessionDisplaySummary(userId, "S", context);
    const pinned = await repository.requireSessionReader(userId, "S", context);
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: "S",
      changes: { timings: [{ ...session.turnTimings[0], modelLoopRound: 2 }] },
    });
    assert.deepEqual(await pinned.readTurnTiming("turn-1"), session.turnTimings[0]);
    assert.equal(
      (await repository.requireSessionReader(userId, "S", context)).generation,
      pinned.generation + 1,
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

test("timing delta preserves the model loop round in storage and display", async () => {
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
        attachments: [],
        messageUid: "sm_round_user",
        ts: TEST_MESSAGE_TS,
        sessionId: "S",
        role: "user",
        messageOrigin: "natural",
        content: "hello",
        turnScopeId: "turn-1",
        dialogProcessId: "dp-1",
      },
      {
        attachments: [],
        messageUid: "sm_round_assistant",
        ts: TEST_MESSAGE_TS,
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
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: session.sessionId,
      changes: { messages: session.messages, timings: session.turnTimings },
    });

    const repository = runtime.repositories.sessionRepository;
    const context = { persistenceContext: repository.treePersistenceContext(userId, "S") };
    const full = await repository.requireById(userId, "S", context);
    const displaySummary = await repository.readSessionDisplaySummary(userId, "S", context);

    const fullTiming = (full.turnTimings || []).find((item) => item.turnScopeId === "turn-1");
    assert.equal(fullTiming?.modelLoopRound, 6);
    const summaryTiming = (displaySummary.turnTimings || []).find(
      (item) => item.turnScopeId === "turn-1",
    );
    assert.equal(summaryTiming?.modelLoopRound, 6);
  });
});
