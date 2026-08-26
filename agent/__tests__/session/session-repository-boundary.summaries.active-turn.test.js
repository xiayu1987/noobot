/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir } from "node:fs/promises";

import { createSessionServices } from "../../src/session/index.js";
import { buildSessionDisplaySummary } from "../../src/session/session-summary-builders.js";
import {
  withTempWorkspace,
  canonicalMessages,
} from "./session-repository-boundary.summaries.fixtures.js";

test("session display summary materializes the active Turn presentation in the zero-event window", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "active-turn-session",
    messages: [
      {
        role: "user",
        type: "message",
        content: "resend request",
        messageUid: "sm-active-user",
        messageId: "sm-active-user",
        messageOrigin: "natural",
        userMetaMaterialized: true,
        turnScopeId: "turn-active",
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "turn-active",
      turns: {
        "turn-active": {
          turnScopeId: "turn-active",
          presentationMessageId: "presentation-active",
          dialogProcessId: "dialog-active",
          state: "processing",
          updatedAt: "2026-07-31T02:53:42.225Z",
        },
      },
    },
  });

  assert.deepEqual(
    summary.messages.map((message) => ({
      role: message.role,
      messageId: message.messageId,
      presentationMessageId: message.presentationMessageId || "",
      turnScopeId: message.turnScopeId,
    })),
    [
      {
        role: "user",
        messageId: "sm-active-user",
        presentationMessageId: "",
        turnScopeId: "turn-active",
      },
      {
        role: "assistant",
        messageId: "presentation-active",
        presentationMessageId: "presentation-active",
        turnScopeId: "turn-active",
      },
    ],
  );
  assert.equal(summary.messages[1].turnPlaceholder, true);
  assert.equal(summary.messages[1].chatPresentation, true);
});

test("session display summary materializes stopped Turn details on its stable presentation", () => {
  const summary = buildSessionDisplaySummary({
    sessionId: "stopped-turn-session",
    messages: [
      {
        role: "user",
        type: "message",
        content: "run tools",
        messageId: "stopped-user",
        turnScopeId: "turn-stopped",
      },
      {
        role: "assistant",
        type: "tool_call",
        chatPresentation: false,
        presentationMessageId: "presentation-stopped",
        turnScopeId: "turn-stopped",
        dialogProcessId: "dialog-stopped",
        toolTimeline: [
          {
            key: "call:stopped",
            toolCallId: "stopped",
            call: { eventId: "call-stopped", sequence: 1 },
            resultEvent: { eventId: "result-stopped", sequence: 2 },
          },
        ],
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: "",
      turns: {
        "turn-stopped": {
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
  assert.equal(stoppedPresentation.thinkingDetailCount, 2);
  assert.equal(stoppedPresentation.toolTimeline.length, 1);
});

test("full and summary Session Detail expose the same canonical active Turn messages", async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const userId = "u1";
    const sessionId = "active-full-detail";
    await mkdir(path.join(workspaceRoot, userId), { recursive: true });
    const runtime = createSessionServices({ workspaceRoot });
    await runtime.sessionTreeService.upsertSessionTree({ userId, sessionId });
    await runtime.sessionCrudService.ensureSession(userId, sessionId, "");

    const session = await runtime.repositories.sessionRepository.findById(userId, sessionId, "");
    session.messages = canonicalMessages(
      [
        {
          id: "user-active-full",
          messageId: "user-active-full",
          messageUid: "user-active-full",
          role: "user",
          type: "message",
          content: "resend request",
          turnScopeId: "turn-active-full",
        },
      ],
      "active_full",
    );
    session.turnLifecycle = {
      activeTurnScopeId: "turn-active-full",
      sequence: 1,
      turns: {
        "turn-active-full": {
          turnScopeId: "turn-active-full",
          presentationMessageId: "presentation-active-full",
          dialogProcessId: "dialog-active-full",
          state: "processing",
          sequence: 1,
          updatedAt: "2026-07-31T03:04:06.000Z",
        },
      },
    };
    await runtime.repositories.sessionRepository.save(userId, session, "");
    await runtime.sessionCrudService.maintainSessionDisplaySummaries({ userId });

    const summaryDetail = await runtime.sessionCrudService.getSessionDisplayData({
      userId,
      sessionId,
    });
    const fullDetail = await runtime.sessionCrudService.getSessionData({ userId, sessionId });
    const summarySession = summaryDetail.sessions[0];
    const fullSession = fullDetail.sessions[0];

    assert.equal(fullDetail.detailMode, "full");
    assert.equal(fullDetail.messageProjection, "canonical-presentation");
    assert.equal(summaryDetail.messageProjection, fullDetail.messageProjection);
    assert.deepEqual(fullSession.messages, summarySession.messages);
    assert.deepEqual(
      fullSession.messages.map((message) => message.messageId),
      ["user-active-full", "presentation-active-full"],
    );
    assert.equal(fullSession.messages[1].turnPlaceholder, true);
    assert.deepEqual(
      fullSession.rawMessages.map((message) => message.messageId),
      ["user-active-full"],
    );
  });
});

test("active Turn summary carries its authoritative thinking timelines", () => {
  const turnScopeId = "client-turn:active-timeline";
  const presentationMessageId = "presentation-active-timeline";
  const summary = buildSessionDisplaySummary({
    sessionId: "active-timeline-session",
    messages: [
      {
        role: "assistant",
        type: "tool_call",
        chatPresentation: false,
        messageId: "source-tool-message",
        presentationMessageId,
        turnScopeId,
        toolTimeline: [
          {
            key: "call:active-tool",
            toolCallId: "active-tool",
            tool: "read_file",
            call: { eventId: "tool-start" },
          },
        ],
        activityTimeline: [{ eventId: "thinking-active", event: "thinking" }],
      },
      {
        role: "assistant",
        type: "tool_call",
        chatPresentation: false,
        messageId: "source-tool-message-2",
        presentationMessageId,
        turnScopeId,
        toolTimeline: [
          {
            key: "call:active-tool-2",
            toolCallId: "active-tool-2",
            tool: "search",
            call: { eventId: "tool-start-2" },
          },
        ],
        activityTimeline: [{ eventId: "thinking-active-2", event: "thinking" }],
      },
    ],
    turnLifecycle: {
      activeTurnScopeId: turnScopeId,
      sequence: 1,
      turns: {
        [turnScopeId]: {
          sessionId: "active-timeline-session",
          turnScopeId,
          dialogProcessId: "dialog-active-timeline",
          presentationMessageId,
          state: "processing",
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
  assert.equal(activePresentation.thinkingDetailCount, 4);
});
