/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import { buildSessionDetailProjection } from "../../../../../../src/modules/session/model/list/sessionDetailProjection.js";
import { selectActivityTimelineLogs } from "../../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import { selectCompletedToolArtifacts } from "../../../../../../src/modules/chat/runtime/engine/toolTimeline.js";
import { canonicalActivityFact } from "../../../chat/helpers/messageEventFixture.js";

const identity = (item) => ({ ...item });

describe("buildSessionDetailProjection", () => {
  it("projects canonical messages through one entrypoint", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [
          { role: "user", content: "hello", turnScopeId: "turn-1", dialogProcessId: "dialog-1" },
        ],
      },
      sessionDocs: [{ sessionId: "session-1" }],
      makeViewMessage: identity,
    });

    expect(projection.sessionId).toBe("session-1");
    expect(projection).not.toHaveProperty("turnTimings");
    expect(projection.messages.some((item) => item.role === "user")).toBe(true);
  });

  it("does not create a mutable timing store from a sparse projection", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-1",
        messages: [{ role: "assistant", content: "streaming", turnScopeId: "turn-1" }],
      },
      makeViewMessage: identity,
    });

    expect(projection).not.toHaveProperty("turnTimingsByTurnScopeId");
  });

  it("projects edited-resend model history to one assistant presentation identity", () => {
    const projection = buildSessionDetailProjection({
      sessionDetail: {
        sessionId: "session-resend",
        messages: [
          {
            userMessageId: "user-resend",
            role: "user",
            content: "edited question",
            turnScopeId: "client-turn:resend",
          },
          {
            presentationMessageId: "assistant-resend",
            role: "assistant",
            type: "tool_call",
            chatPresentation: false,
            content: "inspect first",
            turnScopeId: "client-turn:resend",
            tool_calls: [{ id: "call-1", name: "read_file" }],
            activityTimeline: [
              canonicalActivityFact({
                eventId: "activity-1",
                eventType: "model_analysis_delta",
                text: "inspect first",
                sessionId: "session-resend",
                turnScopeId: "client-turn:resend",
                presentationMessageId: "assistant-resend",
              }),
            ],
          },
          {
            presentationMessageId: "assistant-resend",
            role: "assistant",
            type: "tool_call",
            chatPresentation: false,
            content: "verify next",
            turnScopeId: "client-turn:resend",
            tool_calls: [{ id: "call-2", name: "execute_script" }],
          },
          {
            presentationMessageId: "assistant-resend",
            role: "assistant",
            type: "message",
            chatPresentation: true,
            content: "final answer",
            turnScopeId: "client-turn:resend",
            attachments: [
              {
                attachmentId: "result-1",
                sessionId: "session-resend",
                attachmentSource: "test",
                name: "result.md",
              },
            ],
          },
        ],
      },
      makeViewMessage: identity,
    });

    expect(projection.messages).toHaveLength(2);
    expect(projection.messages[1]).toMatchObject({
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
        messages: [
          {
            presentationMessageId: "assistant-artifacts",
            role: "assistant",
            content: "done",
            turnScopeId: "turn-artifacts",
            dialogProcessId: "dialog-artifacts",
            toolTimeline: [
              {
                key: "call:call-artifacts",
                toolCallId: "call-artifacts",
                tool: "write_file",
                status: "completed",
                resultEvent: {
                  eventId: "event-artifacts",
                  attachments: [
                    {
                      attachmentId: "attachment-artifacts",
                      sessionId: "session-artifacts",
                      attachmentSource: "test",
                      name: "stdout.txt",
                    },
                  ],
                  log: {
                    event: "tool_result",
                    type: "tool_result",
                    toolCallId: "call-artifacts",
                    turnScopeId: "turn-artifacts",
                  },
                },
              },
            ],
          },
        ],
      },
      makeViewMessage: identity,
    });

    expect(projection.messages).toHaveLength(1);
    expect(selectCompletedToolArtifacts(projection.messages[0])).toMatchObject({
      resultCount: 1,
      attachments: [{ attachmentId: "attachment-artifacts", name: "stdout.txt" }],
    });
    expect(selectCompletedToolArtifacts(projection.messages[0])).not.toHaveProperty("writtenFiles");
  });
});
