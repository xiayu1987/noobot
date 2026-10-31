/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { countCanonicalThinkingDetailEvents } from "@noobot/event-protocol/tool-timeline";
import { createEmptyTurnLifecycle } from "@noobot/session-protocol";
import { SESSION_CALLER } from "@noobot/shared/session-caller";
import test from "node:test";
import assert from "node:assert/strict";

import { createTestSessionServices, provisionTestSession } from "../helpers/session-services.js";
import {
  withTempWorkspace,
  canonicalActivity,
  canonicalMessages,
} from "./session-repository-boundary.summaries.fixtures.js";
import { initializeUserWorkspace } from "../helpers/user-workspace.js";
import { applySessionMessageFacts } from "../helpers/session-message-facts.js";
import { TEST_MESSAGE_TS } from "../helpers/session-run-payload.js";
import { buildPersistedDisplaySummary } from "./session-artifact-store-v2.test-helpers.js";

test("session display summary materializes the active Turn presentation in the zero-event window", async () => {
  const summary = await buildPersistedDisplaySummary({
    sessionId: "active-turn-session",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "user",
        type: "message",
        content: "resend request",
        messageUid: "sm-active-user",
        ts: TEST_MESSAGE_TS,
        userMessageId: "sm-active-user",
        messageOrigin: "natural",
        turnScopeId: "turn-active",
      },
    ],
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: "turn-active",
      turns: {
        "turn-active": {
          revision: 1,
          sequence: 1,
          turnScopeId: "turn-active",
          presentationMessageId: "presentation-active",
          dialogProcessId: "dialog-active",
          state: "processing",
          startedAt: "2026-07-31T02:53:40.000Z",
          updatedAt: "2026-07-31T02:53:42.225Z",
        },
      },
    },
  });

  assert.deepEqual(
    summary.messages.map((message) => ({
      role: message.role,
      userMessageId: message.userMessageId,
      modelMessageId: message.modelMessageId,
      presentationMessageId: message.presentationMessageId || "",
      turnScopeId: message.turnScopeId,
    })),
    [
      {
        role: "user",
        userMessageId: "sm-active-user",
        modelMessageId: undefined,
        presentationMessageId: "",
        turnScopeId: "turn-active",
      },
      {
        role: "assistant",
        userMessageId: undefined,
        modelMessageId: undefined,
        presentationMessageId: "presentation-active",
        turnScopeId: "turn-active",
      },
    ],
  );
  assert.equal(summary.messages[1].turnPlaceholder, true);
  assert.equal(summary.messages[1].chatPresentation, true);
});

test("session display summary materializes stopped Turn details on its stable presentation", async () => {
  const summary = await buildPersistedDisplaySummary({
    sessionId: "stopped-turn-session",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "user",
        messageOrigin: "natural",
        type: "message",
        content: "run tools",
        userMessageId: "stopped-user",
        turnScopeId: "turn-stopped",
        dialogProcessId: "dialog-stopped",
      },
      {
        attachments: [],
        role: "assistant",
        modelMessageId: "mm_session_repository_bound_1",
        type: "tool_call",
        tool_calls: [{ id: "stopped", name: "read_file", args: {}, type: "tool_call" }],
        content: "",
        chatPresentation: false,
        presentationMessageId: "presentation-stopped",
        turnScopeId: "turn-stopped",
        dialogProcessId: "dialog-stopped",
        toolTimeline: [
          {
            key: "call:stopped",
            toolCallId: "stopped",
            tool: "read_file",
            args: {},
            call: { eventId: "call-stopped", sequence: 1 },
            result: JSON.stringify({
              ok: false,
              status: "aborted",
              code: "RECOVERABLE_USER_CANCELLED",
              error: "user stop action",
              stopType: "user_stop",
            }),
            success: false,
            resultEvent: { eventId: "result-stopped", sequence: 2 },
          },
        ],
      },
    ],
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: "",
      turns: {
        "turn-stopped": {
          revision: 1,
          turnScopeId: "turn-stopped",
          dialogProcessId: "dialog-stopped",
          presentationMessageId: "presentation-stopped",
          executionState: "user_stopped",
          terminalStatus: { status: "user_stopped" },
          sequence: 2,
        },
      },
    },
  });

  const stoppedPresentation = summary.messages.find(
    (message) => message.presentationMessageId === "presentation-stopped",
  );
  assert.equal(stoppedPresentation.role, "assistant");
  assert.equal(stoppedPresentation.turnPlaceholder, true);
  assert.equal(Object.hasOwn(stoppedPresentation, "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(stoppedPresentation), 2);
  assert.equal(stoppedPresentation.toolTimeline.length, 1);
});

test("Session Detail exposes canonical active Turn messages", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "active-full-detail";
    await initializeUserWorkspace(workspaceRoot, userId);
    const runtime = createTestSessionServices({ workspaceRoot });
    await provisionTestSession(runtime, {
      userId,
      sessionId,
      parentSessionId: "",
      caller: SESSION_CALLER.USER,
    });

    const session = await runtime.repositories.sessionRepository.findById(userId, sessionId, {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        sessionId,
      ),
    });
    session.messages = canonicalMessages(
      [
        {
          attachments: [],
          userMessageId: "user-active-full",
          messageUid: "user-active-full",
          ts: TEST_MESSAGE_TS,
          role: "user",
          messageOrigin: "natural",
          type: "message",
          content: "resend request",
          turnScopeId: "turn-active-full",
        },
      ],
      sessionId,
      "active_full",
    );
    session.turnLifecycle = {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: "turn-active-full",
      sequence: 1,
      turns: {
        "turn-active-full": {
          revision: 1,
          turnScopeId: "turn-active-full",
          presentationMessageId: "presentation-active-full",
          dialogProcessId: "dialog-active-full",
          state: "processing",
          startedAt: "2026-07-31T03:04:00.000Z",
          sequence: 1,
          updatedAt: "2026-07-31T03:04:06.000Z",
        },
      },
    };
    await runtime.repositories.sessionRepository.save(userId, applySessionMessageFacts(session), {
      persistenceContext: runtime.repositories.sessionRepository.treePersistenceContext(
        userId,
        session.sessionId,
      ),
    });
    await runtime.sessionCrudService.maintainSessionDisplaySummaries({ userId });

    const summaryDetail = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId,
    });
    const summarySession = summaryDetail.sessions[0];

    assert.equal(summarySession.availability, "available");
    assert.deepEqual(
      summarySession.messages.map((message) => [
        message.role,
        message.messageUid,
        message.presentationMessageId,
      ]),
      [
        ["user", "user-active-full", undefined],
        ["assistant", undefined, "presentation-active-full"],
      ],
    );
    assert.equal(summarySession.messages[1].turnPlaceholder, true);
  });
});

test("active Turn summary carries its authoritative thinking timelines", async () => {
  const turnScopeId = "client-turn:active-timeline";
  const presentationMessageId = "presentation-active-timeline";
  const summary = await buildPersistedDisplaySummary({
    sessionId: "active-timeline-session",
    aggregateVersion: 0,
    messages: [
      {
        attachments: [],
        role: "assistant",
        type: "tool_call",
        tool_calls: [{ id: "active-tool", name: "read_file", args: {}, type: "tool_call" }],
        content: "",
        chatPresentation: false,
        modelMessageId: "source-tool-message",
        presentationMessageId,
        turnScopeId,
        dialogProcessId: "dialog-active-timeline",
        toolTimeline: [
          {
            key: "call:active-tool",
            toolCallId: "active-tool",
            tool: "read_file",
            args: {},
            call: { eventId: "tool-start" },
          },
        ],
        activityTimeline: [
          canonicalActivity({
            eventId: "thinking-active",
            sequenceScopeId: "source-tool-message",
            sessionId: "active-timeline-session",
            dialogProcessId: "dialog-active-timeline",
            turnScopeId,
            presentationMessageId,
          }),
        ],
      },
      {
        attachments: [],
        role: "assistant",
        type: "tool_call",
        tool_calls: [{ id: "active-tool-2", name: "read_file", args: {}, type: "tool_call" }],
        content: "",
        chatPresentation: false,
        modelMessageId: "source-tool-message-2",
        presentationMessageId,
        turnScopeId,
        dialogProcessId: "dialog-active-timeline",
        toolTimeline: [
          {
            key: "call:active-tool-2",
            toolCallId: "active-tool-2",
            tool: "search",
            args: {},
            call: { eventId: "tool-start-2" },
          },
        ],
        activityTimeline: [
          canonicalActivity({
            eventId: "thinking-active-2",
            sequence: 2,
            sequenceScopeId: "source-tool-message-2",
            sessionId: "active-timeline-session",
            dialogProcessId: "dialog-active-timeline",
            turnScopeId,
            presentationMessageId,
          }),
        ],
      },
    ],
    turnLifecycle: {
      ...createEmptyTurnLifecycle(),
      activeTurnScopeId: turnScopeId,
      sequence: 1,
      turns: {
        [turnScopeId]: {
          revision: 1,
          sequence: 1,
          sessionId: "active-timeline-session",
          turnScopeId,
          dialogProcessId: "dialog-active-timeline",
          presentationMessageId,
          state: "processing",
          startedAt: "2026-07-31T03:10:00.000Z",
        },
      },
    },
  });
  const activePresentation = summary.messages.find(
    (message) => message.presentationMessageId === presentationMessageId,
  );
  assert.equal(activePresentation.toolTimeline.length, 2);
  assert.equal(activePresentation.activityTimeline.length, 2);
  assert.equal(activePresentation.hasThinkingDetails, true);
  assert.equal(Object.hasOwn(activePresentation, "thinkingDetailCount"), false);
  assert.equal(countCanonicalThinkingDetailEvents(activePresentation), 4);
});
