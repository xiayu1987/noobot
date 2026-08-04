/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { buildSessionDetailProjection } from "../../../../../../src/modules/session/model/list/sessionDetailProjection.js";
import { selectActivityTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import { selectCompletedToolArtifacts } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";

const identity = (item) => ({ ...item });

describe("buildSessionDetailProjection", () => {
  it("projects messages, status placeholders and timings through one entrypoint", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [{ role: "user", content: "hello", turnScopeId: "turn-1", dialogProcessId: "dialog-1" }],
        turnStatuses: [{ turnScopeId: "turn-1", dialogProcessId: "dialog-1", status: "thinking" }],
        turnTimings: [{ turnScopeId: "turn-1", thinkingStartedAt: "2026-01-01T00:00:00.000Z" }],
      },
      sessionDocs: [{ sessionId: "session-1" }],
      makeViewMessage: identity,
      foldMessagesForView: (messages) => messages.map(identity),
    });

    expect(projection.sessionId).toBe("session-1");
    expect(projection.turnStatuses[0].status).toBe("thinking");
    expect(projection).not.toHaveProperty("turnTimingsByTurnScopeId");
    expect(projection.messages.some((item) => item.role === "user")).toBe(true);
    expect(projection.messages.some((item) => item.placeholder === true || item.statusTurnScopeId === "turn-1")).toBe(true);
  });

  it("does not create a mutable timing store from a sparse projection", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [{ role: "assistant", content: "streaming", turnScopeId: "turn-1" }],
      },
      makeViewMessage: identity,
      foldMessagesForView: (messages) => messages.map(identity),
    });

    expect(projection).not.toHaveProperty("turnTimingsByTurnScopeId");
  });

  it("indexes workflow node timings by normalized turn scope key", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [{
          role: "assistant",
          content: "child agent done",
          turnScopeId: "workflow-node_client-turn_mrudsmuf_wa7re7tl_a1_1",
          dialogProcessId: "dialog-child-1",
        }],
        turnTimings: [{
          turnScopeId: "workflow-node:client-turn_mrudsmuf_wa7re7tl_a1_1",
          dialogProcessId: "dialog-child-1",
          thinkingStartedAt: "2026-07-21T08:29:00.000Z",
          thinkingFinishedAt: "2026-07-21T08:30:00.000Z",
        }],
      },
      makeViewMessage: identity,
      foldMessagesForView: (messages) => messages.map(identity),
    });

    expect(projection).not.toHaveProperty("turnTimingsByTurnScopeId");
  });

  it("projects edited-resend model history to one assistant presentation identity", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-resend",
        messages: [
          {
            messageId: "user-resend",
            role: "user",
            content: "edited question",
            turnScopeId: "client-turn:resend",
          },
          {
            messageId: "model-tool-call-1",
            presentationMessageId: "assistant-resend",
            role: "assistant",
            type: "tool_call",
            chatPresentation: false,
            content: "inspect first",
            turnScopeId: "client-turn:resend",
            tool_calls: [{ id: "call-1", name: "read_file" }],
            activityTimeline: [{
              eventId: "activity-1",
              event: "main_model_content",
              type: "main_model_content",
              text: "inspect first",
              sequence: 1,
              sequenceScopeId: "model-tool-call-1",
              sequenceDomain: "message-event",
              authority: "authoritative",
            }],
          },
          {
            messageId: "model-tool-call-2",
            presentationMessageId: "assistant-resend",
            role: "assistant",
            type: "tool_call",
            chatPresentation: false,
            content: "verify next",
            turnScopeId: "client-turn:resend",
            tool_calls: [{ id: "call-2", name: "execute_script" }],
          },
          {
            messageId: "model-final",
            presentationMessageId: "assistant-resend",
            role: "assistant",
            type: "message",
            content: "final answer",
            turnScopeId: "client-turn:resend",
            attachments: [{ attachmentId: "result-1", name: "result.md" }],
          },
        ],
      },
      makeViewMessage: identity,
    });

    expect(projection.messages).toHaveLength(2);
    expect(projection.messages[1]).toMatchObject({
      id: "assistant-resend",
      messageId: "assistant-resend",
      presentationMessageId: "assistant-resend",
      content: "final answer",
      type: "message",
    });
    expect(projection.messages[1].tool_calls.map((item) => item.id)).toEqual(["call-1", "call-2"]);
    expect(projection.messages[1].attachments).toEqual([
      expect.objectContaining({ attachmentId: "result-1" }),
    ]);
    expect(selectActivityTimelineLogs(projection.messages[1])).toEqual([
      expect.objectContaining({ eventId: "activity-1", text: "inspect first" }),
    ]);
  });

  it("preserves the canonical completed-tool artifact projection during detail hydration", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-artifacts",
        messages: [{
          id: "assistant-artifacts",
          role: "assistant",
          content: "done",
          turnScopeId: "turn-artifacts",
          dialogProcessId: "dialog-artifacts",
          toolTimeline: [{
            key: "call:call-artifacts",
            toolCallId: "call-artifacts",
            tool: "write_file",
            status: "completed",
            resultEvent: {
              eventId: "event-artifacts",
              attachments: [{ attachmentId: "attachment-artifacts", name: "stdout.txt" }],
              writtenFiles: [{
                toolName: "write_file",
                resolvedPath: "/workspace/result.txt",
                fileName: "result.txt",
              }],
              log: {
                event: "tool_result",
                type: "tool_result",
                toolCallId: "call-artifacts",
                turnScopeId: "turn-artifacts",
              },
            },
          }],
        }],
      },
      makeViewMessage: identity,
    });

    expect(projection.messages).toHaveLength(1);
    expect(selectCompletedToolArtifacts(projection.messages[0])).toMatchObject({
      resultCount: 1,
      attachments: [{ attachmentId: "attachment-artifacts", name: "stdout.txt" }],
      writtenFiles: [{ fileName: "result.txt" }],
    });
  });
});
