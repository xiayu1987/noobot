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

function activity(eventId, sequence, text) {
  return {
    eventId,
    eventType: "thinking",
    text,
    activityKind: "analysis",
    purpose: "",
    pluginFlow: "",
    chain: "",
    sequence,
    sequenceScopeId: "message-logs",
    sequenceDomain: "message-event",
    authority: "authoritative",
    timestamp: `2026-09-05T03:39:${String(sequence).padStart(2, "0")}.000Z`,
    sessionId: "session-logs",
    dialogProcessId: "dp-logs",
    turnScopeId: "client-turn:logs",
    messageId: "message-logs",
    presentationMessageId: "presentation-logs",
  };
}

describe("messageModel activity timeline folding", () => {
  it("keeps all canonical activities when merging completed assistant messages", () => {
    const messages = foldConversationMessages(
      [
        {
          role: "assistant",
          content: "part 1",
          turnScopeId: "client-turn:logs",
          dialogProcessId: "dp-logs",
          activityTimeline: Array.from({ length: 6 }, (_, index) =>
            activity(`log-${index + 1}`, index + 1, `log-${index + 1}`),
          ),
          executionLogTotal: 6,
        },
        {
          role: "assistant",
          content: "part 2",
          turnScopeId: "client-turn:logs",
          dialogProcessId: "dp-logs",
          activityTimeline: Array.from({ length: 6 }, (_, index) =>
            activity(`log-${index + 7}`, index + 7, `log-${index + 7}`),
          ),
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
