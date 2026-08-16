/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";
import { buildViewMessage, foldConversationMessages } from "../../../../../src/modules/chat/model/messageModel.js";
import { selectActivityTimelineLogs } from "../../../../../src/modules/chat/runtime/engine/activityTimeline.js";

describe("messageModel activity timeline folding", () => {
  it("keeps all canonical activities when merging completed assistant messages", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "part 1",
          turnScopeId: "client-turn:logs",
          dialogProcessId: "dp-logs",
          activityTimeline: Array.from({ length: 6 }, (_, index) => ({
            activityId: `event:log-${index + 1}`,
            eventId: `log-${index + 1}`,
            event: "thinking",
            type: "thinking",
            text: `log-${index + 1}`,
            sequence: index + 1,
            sequenceScopeId: "message-logs",
            sequenceDomain: "message-event",
            authority: "authoritative",
          })),
          executionLogTotal: 6,
        },
        {
          role: "assistant",
          content: "part 2",
          turnScopeId: "client-turn:logs",
          dialogProcessId: "dp-logs",
          activityTimeline: Array.from({ length: 6 }, (_, index) => ({
            activityId: `event:log-${index + 7}`,
            eventId: `log-${index + 7}`,
            event: "thinking",
            type: "thinking",
            text: `log-${index + 7}`,
            sequence: index + 7,
            sequenceScopeId: "message-logs",
            sequenceDomain: "message-event",
            authority: "authoritative",
          })),
          executionLogTotal: 12,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    const logs = selectActivityTimelineLogs(messages[0]);
    expect(logs).toHaveLength(12);
    expect(logs[0].text).toBe("log-1");
    expect(logs[11].text).toBe("log-12");
  });

  it("keeps thinking intervals out of folded messages when continuing the same turn", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "initial attempt",
          turnScopeId: "client-turn:continue",
          dialogProcessId: "dp-continue",
          thinkingStartedAt: 1700000000000,
          thinkingFinishedAt: 1700000001000,
        },
        {
          role: "assistant",
          content: "continued attempt",
          turnScopeId: "client-turn:continue",
          dialogProcessId: "dp-continue",
          thinkingStartedAt: 1700000010000,
          thinkingFinishedAt: 1700000012000,
        },
      ],
      buildViewMessage,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].thinkingStartedAt).toBeUndefined();
    expect(messages[0].thinkingFinishedAt).toBeUndefined();
  });
});
