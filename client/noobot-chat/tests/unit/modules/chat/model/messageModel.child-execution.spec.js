/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import {
  buildViewMessage,
  foldConversationMessages,
} from "../../../../../src/modules/chat/model/messageModel.js";

describe("messageModel child execution projections", () => {
  it("keeps summary thinking entry fields when merging assistant messages", () => {
    const messages = foldConversationMessages(
      [
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "part 1",
          turnScopeId: "client-turn:summary-thinking",
          dialogProcessId: "dp-summary-thinking",
        },
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "part 2",
          turnScopeId: "client-turn:summary-thinking",
          dialogProcessId: "dp-summary-thinking",
          hasThinkingDetails: true,
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].hasThinkingDetails).toBe(true);
  });

  it("keeps child-session thinking and tool facets on view messages", () => {
    const toolTimeline = [
      {
        key: "call:call-1",
        toolCallId: "call-1",
        status: "running",
      },
    ];
    const messages = foldConversationMessages(
      [
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "done",
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          thinking: "checking the workspace",
          toolCall: { id: "call-1", name: "read_file", args: { filePath: "notes.txt" } },
          toolResult: { id: "call-1", output: "file body" },
          toolTimeline,
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        thinking: "checking the workspace",
        toolCall: expect.objectContaining({ id: "call-1", name: "read_file" }),
        toolResult: expect.objectContaining({ id: "call-1", output: "file body" }),
        toolTimeline,
      }),
    );
  });

  it("preserves a running child execution status through the view boundary", () => {
    const messages = foldConversationMessages(
      [
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "",
          pending: true,
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          statusTurnScopeId: "workflow-node:child",
          projectedStatusStepState: "completing",
          workflowNodeRunningPlaceholder: true,
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completing",
    });
  });

  it("preserves terminal child execution status while folding same-turn assistant fragments", () => {
    const messages = foldConversationMessages(
      [
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "part 1",
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          statusTurnScopeId: "workflow-node:child",
          projectedStatusStepState: "completed",
        },
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "part 2",
          sessionId: "child-session",
          turnScopeId: "workflow-node:child",
          statusTurnScopeId: "workflow-node:child",
          projectedStatusStepState: "completing",
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      statusTurnScopeId: "workflow-node:child",
      projectedStatusStepState: "completed",
    });
  });

  it("does not merge child execution status across turns", () => {
    const messages = foldConversationMessages(
      [
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "first turn",
          sessionId: "child-session",
          turnScopeId: "workflow-node:first",
          statusTurnScopeId: "workflow-node:first",
          projectedStatusStepState: "completed",
        },
        {
          ts: "2026-01-01T00:00:00.000Z",
          role: "assistant",
          content: "second turn",
          sessionId: "child-session",
          turnScopeId: "workflow-node:second",
          statusTurnScopeId: "workflow-node:second",
          projectedStatusStepState: "completing",
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.projectedStatusStepState)).toEqual([
      "completed",
      "completing",
    ]);
  });
});
