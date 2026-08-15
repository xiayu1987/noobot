/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildViewMessage, foldConversationMessages } from "../../../../../src/modules/chat/model/messageModel.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";

describe("messageModel presentation identity", () => {
  it("projects the canonical persisted model analysis onto the presentation message", () => {
    const messages = foldConversationMessages(
      [
        {
          messageUid: "sm-analysis-1",
          messageId: "msg-model-1",
          presentationMessageId: "msg-chat-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "I should inspect the repository first.",
          activityTimeline: [
            {
              eventId: "model-content:msg-model-1",
              sequence: 1,
              sequenceScopeId: "msg-model-1",
              sequenceDomain: "message-event",
              authority: "authoritative",
              event: "main_model_content",
              type: "main_model_content",
              text: "I should inspect the repository first.",
              log: {
                eventId: "model-content:msg-model-1",
                event: "main_model_content",
                type: "main_model_content",
                text: "I should inspect the repository first.",
              },
            },
          ],
          turnScopeId: "client-turn:refresh",
          dialogProcessId: "dp-refresh",
          ts: "2026-07-29T01:00:00.000Z",
        },
        {
          messageUid: "sm-final-1",
          messageId: "msg-model-2",
          presentationMessageId: "msg-chat-1",
          chatPresentation: true,
          role: "assistant",
          type: "message",
          content: "Final answer",
          turnScopeId: "client-turn:refresh",
          dialogProcessId: "dp-refresh",
          ts: "2026-07-29T01:01:00.000Z",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "msg-chat-1",
      messageId: "msg-chat-1",
      content: "Final answer",
    });
    expect(selectActivityTimelineLogs(messages[0])).toEqual([
      expect.objectContaining({
        event: "main_model_content",
        text: "I should inspect the repository first.",
      }),
    ]);
  });

  it("projects model-history records through one explicit chat presentation", () => {
    const messages = foldConversationMessages(
      [
        {
          messageId: "model-tool-call-1",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "inspect first",
          turnScopeId: "client-turn:canonical-presentation",
          tool_calls: [{ id: "call-1", name: "read_file" }],
          activityTimeline: [
            {
              eventId: "activity-1",
              sequence: 1,
              sequenceScopeId: "model-tool-call-1",
              sequenceDomain: "message-event",
              authority: "authoritative",
              event: "main_model_content",
              type: "main_model_content",
              text: "inspect first",
              log: {
                eventId: "activity-1",
                event: "main_model_content",
                type: "main_model_content",
                text: "inspect first",
              },
            },
          ],
        },
        {
          messageId: "model-tool-call-2",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "verify next",
          turnScopeId: "client-turn:canonical-presentation",
          tool_calls: [{ id: "call-2", name: "execute_script" }],
        },
        {
          messageId: "model-final",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          type: "message",
          content: "Final answer",
          turnScopeId: "client-turn:canonical-presentation",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant-presentation-1",
      chatPresentation: true,
      content: "Final answer",
      type: "message",
    });
    expect(messages[0].tool_calls.map((item) => item.id)).toEqual(["call-1", "call-2"]);
    expect(selectActivityTimelineLogs(messages[0])).toEqual([
      expect.objectContaining({ eventId: "activity-1", text: "inspect first" }),
    ]);
  });

  it("does not fold two explicit chat presentations into one entity", () => {
    const messages = foldConversationMessages(
      [
        {
          messageId: "model-final-1",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          content: "First answer",
          turnScopeId: "client-turn:duplicate-presentation",
        },
        {
          messageId: "model-final-2",
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          content: "Second answer",
          turnScopeId: "client-turn:duplicate-presentation",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
  });

  it("excludes non-chat context control entities from every conversation projection", () => {
    const messages = foldConversationMessages(
      [
        {
          messageUid: "sm-control-1",
          role: "user",
          type: "context_control",
          content: "periodic task check control",
          chatPresentation: false,
          noobotInternalMessageType: "noobot.task_check_prompt",
          turnScopeId: "workflow-node:control-1",
          dialogProcessId: "dp-control-1",
        },
        {
          messageUid: "sm-user-1",
          role: "user",
          content: "real workflow node task",
          turnScopeId: "workflow-node:control-1",
          dialogProcessId: "dp-control-1",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(
      expect.objectContaining({ role: "user", content: "real workflow node task" }),
    );
  });

  it("folds a pending shell and persisted fragment with one presentation identity", () => {
    const messages = foldConversationMessages(
      [
        {
          messageId: "msg-chat-running",
          presentationMessageId: "msg-chat-running",
          role: "assistant",
          type: "message",
          content: "",
          pending: true,
          turnScopeId: "client-turn:running",
        },
        {
          messageId: "msg-model-tool-call",
          presentationMessageId: "msg-chat-running",
          role: "assistant",
          type: "tool_call",
          content: "",
          pending: false,
          turnScopeId: "client-turn:running",
          tool_calls: [{ id: "tool-call-1", name: "write_file" }],
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "msg-chat-running",
      messageId: "msg-chat-running",
      presentationMessageId: "msg-chat-running",
      pending: true,
      turnScopeId: "client-turn:running",
    });
    expect(messages[0].tool_calls).toEqual([
      expect.objectContaining({ id: "tool-call-1", name: "write_file" }),
    ]);
  });

});
