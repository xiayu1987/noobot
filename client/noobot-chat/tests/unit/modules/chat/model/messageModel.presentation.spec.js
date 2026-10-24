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
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";
import { canonicalActivityFact } from "../helpers/messageEventFixture.js";
import { CONTEXT_INJECTED_MESSAGE_TYPE } from "@noobot/context-protocol/policy/injected-message";
import {
  THINKING_DETAIL_CONTENT_KIND,
  projectThinkingDetailContentTimeline,
} from "@noobot/event-protocol/thinking-detail-content";

describe("messageModel presentation identity", () => {
  it("projects the canonical persisted model analysis onto the presentation message", () => {
    const messages = foldConversationMessages(
      [
        {
          messageUid: "sm-analysis-1",
          presentationMessageId: "msg-chat-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "I should inspect the repository first.",
          activityTimeline: [
            canonicalActivityFact({
              eventId: "activity-model-1",
              eventType: "model_analysis_delta",
              text: "I should inspect the repository first.",
              presentationMessageId: "msg-chat-1",
              turnScopeId: "client-turn:refresh",
              dialogProcessId: "dp-refresh",
            }),
          ],
          turnScopeId: "client-turn:refresh",
          dialogProcessId: "dp-refresh",
          ts: "2026-07-29T01:00:00.000Z",
        },
        {
          messageUid: "sm-final-1",
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
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      presentationMessageId: "msg-chat-1",
      content: "Final answer",
    });
    expect(selectActivityTimelineLogs(messages[0])).toEqual([
      expect.objectContaining({
        eventType: "model_analysis_delta",
        text: "I should inspect the repository first.",
      }),
    ]);
  });

  it("projects model-history records through one explicit chat presentation", () => {
    const messages = foldConversationMessages(
      [
        {
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "inspect first",
          turnScopeId: "client-turn:canonical-presentation",
          tool_calls: [{ id: "call-1", name: "read_file" }],
          activityTimeline: [
            canonicalActivityFact({
              eventId: "activity-1",
              eventType: "model_analysis_delta",
              text: "inspect first",
              presentationMessageId: "assistant-presentation-1",
              turnScopeId: "client-turn:canonical-presentation",
            }),
          ],
        },
        {
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: false,
          role: "assistant",
          type: "tool_call",
          content: "verify next",
          turnScopeId: "client-turn:canonical-presentation",
          tool_calls: [{ id: "call-2", name: "execute_script" }],
        },
        {
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          type: "message",
          content: "Final answer",
          turnScopeId: "client-turn:canonical-presentation",
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      presentationMessageId: "assistant-presentation-1",
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
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          content: "First answer",
          turnScopeId: "client-turn:duplicate-presentation",
        },
        {
          presentationMessageId: "assistant-presentation-1",
          chatPresentation: true,
          role: "assistant",
          content: "Second answer",
          turnScopeId: "client-turn:duplicate-presentation",
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
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
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
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
          presentationMessageId: "msg-chat-running",
          role: "assistant",
          type: "message",
          content: "",
          pending: true,
          turnScopeId: "client-turn:running",
        },
        {
          presentationMessageId: "msg-chat-running",
          role: "assistant",
          type: "tool_call",
          content: "",
          pending: false,
          turnScopeId: "client-turn:running",
          tool_calls: [{ id: "tool-call-1", name: "write_file" }],
        },
      ],
      (message) => buildViewMessage(message, { sessionId: "session-1" }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      presentationMessageId: "msg-chat-running",
      pending: true,
      turnScopeId: "client-turn:running",
    });
    expect(messages[0].tool_calls).toEqual([
      expect.objectContaining({ id: "tool-call-1", name: "write_file" }),
    ]);
  });

  it("keeps hidden user interjection content for the thinking detail timeline", () => {
    const interjection = buildViewMessage(
      {
        messageUid: "sm-interjection-1",
        role: "user",
        type: "message",
        chatPresentation: false,
        injectedMessage: true,
        injectedMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
        noobotInternalMessageType: CONTEXT_INJECTED_MESSAGE_TYPE.USER_INTERJECTION,
        content: "please also check the tests",
        ts: "2026-01-01T00:00:01.000Z",
        interjectionSequence: 1,
        sessionId: "s-1",
        dialogProcessId: "dp-1",
        turnScopeId: "turn-1",
      },
      { sessionId: "s-1" },
    );

    expect(interjection.content).toBe("please also check the tests");
    expect(projectThinkingDetailContentTimeline([interjection], [])).toEqual([
      expect.objectContaining({
        contentId: "message:sm-interjection-1",
        contentKind: THINKING_DETAIL_CONTENT_KIND.USER_INTERJECTION,
        text: "please also check the tests",
        sequence: 1,
      }),
    ]);
  });
});
