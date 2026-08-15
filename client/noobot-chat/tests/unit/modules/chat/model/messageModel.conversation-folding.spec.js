/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildViewMessage, foldConversationMessages } from "../../../../../src/modules/chat/model/messageModel.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";

describe("messageModel conversation folding", () => {
  it("does not merge a new pending assistant placeholder with previous turn state", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "previous answer",
          dialogProcessId: "dp-same-until-stream-arrives",
          attachments: [
            {
              attachmentId: "att-prev",
              sessionId: "child-session",
              attachmentSource: "test",
              name: "previous.md",
            },
          ],
          realtimeLogs: [{ text: "previous tool log" }],
          completedToolLogs: [{ text: "previous completed tool" }],
          tool_calls: [{ id: "tool-prev" }],
          executionLogTotal: 1,
        },
        {
          role: "assistant",
          content: "",
          dialogProcessId: "dp-same-until-stream-arrives",
          pending: true,
          attachments: [],
          realtimeLogs: [],
          completedToolLogs: [],
          tool_calls: [],
          executionLogTotal: 0,
          statusLabel: "",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[1].pending).toBe(true);
    expect(messages[1].attachments).toEqual([]);
    expect(messages[1].toolTimeline).toEqual([]);
    expect(messages[1].activityTimeline).toEqual([]);
    expect(messages[1].tool_calls).toEqual([]);
    expect(messages[1].statusLabel).toBe("");
  });

  it("fills the new assistant turn only after non-pending stream events arrive", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "new partial answer",
          turnScopeId: "client-turn:new-stream",
          dialogProcessId: "dp-new-stream",
          attachments: [
            {
              attachmentId: "att-new",
              sessionId: "child-session",
              attachmentSource: "test",
              name: "new.md",
            },
          ],
          activityTimeline: [
            {
              activityId: "event:new-log-1",
              eventId: "new-log-1",
              event: "thinking",
              type: "thinking",
              text: "new tool log",
              sequence: 1,
              sequenceScopeId: "message-new",
              sequenceDomain: "message-event",
              authority: "authoritative",
            },
          ],
          tool_calls: [{ id: "tool-new" }],
          executionLogTotal: 1,
        },
        {
          role: "assistant",
          content: "new continuation",
          turnScopeId: "client-turn:new-stream",
          dialogProcessId: "dp-new-stream",
          activityTimeline: [
            {
              activityId: "event:new-log-2",
              eventId: "new-log-2",
              event: "thinking",
              type: "thinking",
              text: "new tool log 2",
              sequence: 2,
              sequenceScopeId: "message-new",
              sequenceDomain: "message-event",
              authority: "authoritative",
            },
          ],
          executionLogTotal: 2,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain("new partial answer");
    expect(messages[0].content).toContain("new continuation");
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments[0]).toMatchObject({ attachmentId: "att-new" });
    expect(selectActivityTimelineLogs(messages[0])).toHaveLength(2);
    expect(messages[0].tool_calls).toHaveLength(1);
  });

  it("keeps the user message and merges assistant projections with the same stable id", () => {
    const messages = foldConversationMessages(
      [
        {
          id: "storage-user-1",
          role: "user",
          content: "question",
          turnScopeId: "client-turn:render-1",
        },
        {
          id: "storage-assistant-1",
          role: "assistant",
          content: "answer part 1",
          dialogProcessId: "dp-render-1",
          turnScopeId: "client-turn:render-1",
        },
        {
          id: "storage-assistant-1",
          role: "assistant",
          content: "answer part 2",
          dialogProcessId: "dp-render-1",
          turnScopeId: "client-turn:render-1",
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        content: "question",
      }),
    );
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toContain("answer part 1");
    expect(messages[1].content).toContain("answer part 2");
  });

});
