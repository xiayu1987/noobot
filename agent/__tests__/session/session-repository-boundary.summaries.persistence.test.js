/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  createTestSessionServices,
  provisionTestSession,
  withTreeContext,
  commitTestSessionChanges,
} from "../helpers/session-services.js";
import {
  withTempWorkspace,
  canonicalActivity,
  canonicalMessages,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";

test("message delta refreshes the display projection with live activity timeline", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "live",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const messages = canonicalMessages(
      [
        {
          attachments: [],
          role: "assistant",
          modelMessageId: "mm_session_repository_bound_1",
          type: "tool_call",
          tool_calls: [{ id: "call-1", name: "read_file", args: {}, type: "tool_call" }],
          content: "",
          chatPresentation: false,
          presentationMessageId: "presentation-live",
          turnScopeId: "turn-live",
          activityTimeline: [
            canonicalActivity({
              eventId: "guidance-analysis:live",
              activityKind: "guidance_analysis",
              purpose: "guidance",
              pluginFlow: "analysis",
              chain: "auxiliary",
              text: "analysis in progress",
              sequenceScopeId: "model-live",
              sessionId: "live",
              turnScopeId: "turn-live",
              presentationMessageId: "presentation-live",
            }),
          ],
        },
      ],
      "live",
      "live",
    );
    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: "live",
      changes: { messages },
    });

    const display = await runtime.repositories.sessionRepository.readSessionDisplaySummary(
      userId,
      "live",
      {
        persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
          userId,
          "live",
        ),
      },
    );
    assert.equal(display.messages.length, 1);
    assert.equal(display.messages[0].presentationMessageId, "presentation-live");
    assert.equal(Object.hasOwn(display.messages[0], "thinkingDetailCount"), false);
    assert.equal(countCanonicalThinkingDetailEvents(display.messages[0]), 1);
    assert.equal(display.messages[0].activityTimeline.length, 1);
    assert.equal(display.messages[0].activityTimeline[0].eventId, "guidance-analysis:live");
  });
});

test("message delta and display reads never write a duplicate display summary", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "single-summary-write",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const repository = runtime.repositories.sessionRepository;
    const originalWriteJsonAtomic = repository.storageService.writeJsonAtomic.bind(
      repository.storageService,
    );
    let displaySummaryWrites = 0;
    repository.storageService.writeJsonAtomic = async (filePath, payload) => {
      if (String(filePath).endsWith(`${path.sep}session-summary.json`)) displaySummaryWrites += 1;
      return originalWriteJsonAtomic(filePath, payload);
    };
    const messages = canonicalMessages(
      [{ attachments: [], role: "user", messageOrigin: "natural", content: "one durable update" }],
      "single-summary-write",
      "single_write",
    );

    await commitTestSessionChanges(runtime, {
      userId,
      sessionId: "single-summary-write",
      changes: { messages },
    });
    assert.equal(displaySummaryWrites, 0);
    await repository.readSessionDisplaySummary(userId, "single-summary-write", {
      persistenceContext: repository.treePersistenceContext(userId, "single-summary-write"),
    });
    assert.equal(displaySummaryWrites, 0);
    await repository.readSessionDisplaySummary(userId, "single-summary-write", {
      persistenceContext: repository.treePersistenceContext(userId, "single-summary-write"),
    });
    assert.equal(displaySummaryWrites, 0);
  });
});

test("summary checkpoint receipts survive immutable persistence with historical targets", async (t) => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "checkpoint-receipt";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const repository = runtime.repositories.sessionRepository;
    const messages = canonicalMessages(
      [
        {
          attachments: [],
          messageUid: "sm_historical",
          ts: TEST_MESSAGE_TS,
          sessionId,
          role: "assistant",
          modelMessageId: "mm_historical",
          presentationMessageId: "pm_turn-old",
          content: "historical guidance",
          dialogProcessId: "dialog-old",
          turnScopeId: "turn-old",
        },
        {
          attachments: [],
          messageUid: "sm_current",
          ts: TEST_MESSAGE_TS,
          sessionId,
          role: "user",
          messageOrigin: "natural",
          content: "current request",
          dialogProcessId: "dialog-current",
          turnScopeId: "turn-current",
        },
      ],
      sessionId,
    );
    await commitTestSessionChanges(runtime, { userId, sessionId, changes: { messages } });
    for (const event of [
      {
        eventType: "turn.action_accepted",
        phase: "action",
        action: "send",
        presentationMessageId: "presentation-current",
        executionId: "agent:turn-current",
        executionKind: "agent",
        rootExecutionId: "agent:turn-current",
      },
      { eventType: "turn.processing_started", phase: "processing" },
    ]) {
      await commitTestSessionChanges(runtime, {
        userId,
        sessionId,
        changes: {
          turnTransition: {
            ...event,
            sessionId,
            turnScopeId: "turn-current",
            dialogProcessId: "dialog-current",
            commandId: event.eventType,
            causationId: event.eventType,
          },
        },
      });
    }

    assert.equal(repository.save, undefined, "full session writes have no runtime entry point");
    for (const method of ["requireById", "findById"]) {
      t.mock.method(repository, method, () => {
        throw new Error(`full session ${method} is forbidden`);
      });
    }
    const checkpoint = {
      userId,
      sessionId,
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      checkpointId: "checkpoint-with-history",
      expectedCheckpointRevision: 0,
      persistedMessageUids: [],
      summarizedMessageUids: ["sm_historical"],
      retainedMessageUids: [],
      messages: [],
    };
    const committed = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(
      withTreeContext(runtime, checkpoint),
    );
    assert.equal(committed.committed, true);
    const selected = await runtime.sessionMessageService.getSessionMessageSources(
      withTreeContext(runtime, {
        userId,
        sessionId,
        messageUids: ["sm_current", "sm_historical", "sm_current"],
        turnScopeIds: ["turn-current", "turn-historical"],
      }),
    );
    assert.deepEqual(
      selected.map((message) => message.messageUid),
      ["sm_current", "sm_historical"],
    );
    await assert.rejects(
      runtime.sessionMessageService.getSessionMessageSources(
        withTreeContext(runtime, {
          userId,
          sessionId,
          messageUids: ["missing-source"],
          turnScopeIds: [],
        }),
      ),
      /Session message source is missing: missing-source/,
    );
    const state = await runtime.sessionMessageService.getTurnSummaryCheckpointState(
      withTreeContext(runtime, checkpoint),
    );
    assert.equal(state.checkpointRevision, 1);
    const timing = withTreeContext(runtime, {
      userId,
      sessionId,
      dialogProcessId: "dialog-current",
      turnScopeId: "turn-current",
      thinkingFinishedAt: "2026-11-12T00:00:00.000Z",
      modelLoopRound: 1,
    });
    assert.equal((await runtime.sessionMessageService.upsertTurnTiming(timing)).upserted, true);
    assert.equal(
      (await runtime.sessionMessageService.upsertTurnTiming(timing)).reason,
      "unchanged",
    );

    const reader = await repository.requireSessionReader(userId, sessionId, {
      persistenceContext: repository.treePersistenceContext(userId, sessionId),
    });
    const reloaded = await reader.exportSession();
    const receipt = await reader.readCheckpoint("turn-current", checkpoint.checkpointId);
    assert.deepEqual(receipt.summarizedMessageUids, ["sm_historical"]);
    assert.deepEqual(
      reloaded.turnSummaryCheckpoints["turn-current"].receipts[0].summarizedMessageUids,
      ["sm_historical"],
    );
    assert.equal(
      reloaded.messages.find((message) => message.messageUid === "sm_historical").summarized,
      true,
    );
    assert.deepEqual(
      reloaded.turnSummaryCheckpoints["turn-current"].receipts[0].summarizedMessageUids,
      ["sm_historical"],
    );
    const replay = await runtime.sessionMessageService.commitTurnSummaryCheckpoint(
      withTreeContext(runtime, checkpoint),
    );
    assert.equal(replay.deduplicated, true);
  });
});

test("concurrent deltas for different sessions preserve every sessions summary entry", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await runtime.sessionPathResolver.commitSessionPlacement(userId, {
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "A",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    await provisionTestSession(runtime, {
      userId,
      sessionId: "B",
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });
    const messagesA = canonicalMessages(
      [{ attachments: [], role: "user", messageOrigin: "natural", content: "updated A" }],
      "A",
      "concurrent_a",
    );
    const messagesB = canonicalMessages(
      [{ attachments: [], role: "user", messageOrigin: "natural", content: "updated B" }],
      "B",
      "concurrent_b",
    );

    await Promise.all([
      commitTestSessionChanges(runtime, {
        userId,
        sessionId: "A",
        changes: { messages: messagesA },
      }),
      commitTestSessionChanges(runtime, {
        userId,
        sessionId: "B",
        changes: { messages: messagesB },
      }),
    ]);

    const summary = await runtime.repositories.sessionRepository.readSessionsSummary(userId);
    assert.deepEqual(summary.sessions.map((item) => item.sessionId).sort(), ["A", "B"]);
    assert.equal(summary.sessions.find((item) => item.sessionId === "A").title, "updated A");
    assert.equal(summary.sessions.find((item) => item.sessionId === "B").title, "updated B");
  });
});
