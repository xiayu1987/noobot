import { describe, expect, it, vi } from "vitest";

import {
  buildThinkingDetailsRoute,
  getThinkingDetailsCount,
  getThinkingDetailsTitle,
  resolveFallbackThinkingDetailsPayload,
  resolveThinkingDetailsPanelPayload,
} from "../../../src/app/state/thinkingDetailsState";

describe("thinking details state", () => {
  it("counts completed tool logs before other thinking sources", () => {
    expect(getThinkingDetailsCount({
      completedToolLogs: [{ id: 1 }, { id: 2 }],
      toolCalls: [{ id: 3 }],
      realtimeLogs: [{ event: "tool_call" }],
    })).toBe(2);
  });

  it("counts tool calls when completed logs are absent", () => {
    expect(getThinkingDetailsCount({ toolCalls: [{ id: 1 }, { id: 2 }, { id: 3 }] })).toBe(3);
  });

  it("counts realtime log entries that mention tool or function", () => {
    expect(getThinkingDetailsCount({
      realtimeLogs: [
        { event: "message.delta" },
        { event: "tool_call.created" },
        { type: "function_result" },
        { event: "THINKING" },
      ],
    })).toBe(2);
  });

  it("counts summary thinking details when full log arrays are absent", () => {
    expect(getThinkingDetailsCount({
      role: "assistant",
      turnScopeId: "turn-1",
      hasThinkingDetails: true,
      thinkingDetailCount: 4,
    })).toBe(4);
  });

  it("falls through empty normalized log arrays to summary thinking detail count", () => {
    expect(getThinkingDetailsCount({
      role: "assistant",
      turnScopeId: "turn-1",
      hasThinkingDetails: true,
      completedToolLogs: [],
      realtimeLogs: [],
      thinkingDetailCount: 4,
    })).toBe(4);
  });

  it("builds a translated title with the derived count", () => {
    const translate = vi.fn((key, params) => `${key}:${params.count}`);

    expect(getThinkingDetailsTitle({ toolCalls: [{ id: 1 }] }, translate)).toBe("message.thinkingDetails:1");
    expect(translate).toHaveBeenCalledWith("message.thinkingDetails", { count: 1 });
  });

  it("resolves the latest assistant message with thinking details from the active session", () => {
    const plainAssistant = { role: "assistant", content: "done" };
    const thinkingAssistant = { role: "assistant", turnScopeId: "turn-2", realtimeLogs: [{ event: "tool_call" }] };
    const pendingAssistant = { role: "assistant", turnScopeId: "turn-1", pending: true };
    const messages = [
      { role: "user", content: "hi" },
      pendingAssistant,
      plainAssistant,
      thinkingAssistant,
    ];

    expect(resolveFallbackThinkingDetailsPayload({ messages })).toEqual({
      messageItem: thinkingAssistant,
      allMessages: messages,
    });
  });

  it("resolves summary thinking placeholder messages from session-summary data", () => {
    const summaryThinkingAssistant = {
      role: "assistant",
      turnScopeId: "turn-1",
      content: "done",
      hasThinkingDetails: true,
      thinkingDetailCount: 3,
    };
    const messages = [
      { role: "user", content: "hi" },
      summaryThinkingAssistant,
    ];

    expect(resolveFallbackThinkingDetailsPayload({ messages })).toEqual({
      messageItem: summaryThinkingAssistant,
      allMessages: messages,
    });
  });

  it("falls back to session messages and null message item when no thinking message exists", () => {
    const messages = [{ role: "user", content: "hi" }];

    expect(resolveFallbackThinkingDetailsPayload({ messages })).toEqual({
      messageItem: null,
      allMessages: messages,
    });
  });

  it("does not expose stale thinking details for assistant messages without turn scope", () => {
    const staleAssistant = {
      role: "assistant",
      completedToolLogs: [{ id: 1 }],
      realtimeLogs: [{ event: "tool_call" }],
      hasThinkingDetails: true,
      thinkingDetailCount: 3,
    };
    const messages = [{ role: "user", content: "hi" }, staleAssistant];

    expect(getThinkingDetailsCount(staleAssistant)).toBe(0);
    expect(resolveFallbackThinkingDetailsPayload({ messages })).toEqual({
      messageItem: null,
      allMessages: messages,
    });
  });

  it("prefers explicit payload values over fallback values", () => {
    const explicitMessage = { role: "assistant", completedToolLogs: [] };
    const explicitMessages = [explicitMessage];
    const fallbackMessage = { role: "assistant", pending: true };

    expect(resolveThinkingDetailsPanelPayload(
      { messageItem: explicitMessage, allMessages: explicitMessages },
      { messageItem: fallbackMessage, allMessages: [fallbackMessage] },
    )).toEqual({
      messageItem: explicitMessage,
      allMessages: explicitMessages,
    });
  });

  it("builds the pseudo route for opening thinking details", () => {
    expect(buildThinkingDetailsRoute("session-1", "thinking-details")).toEqual({
      sessionId: "session-1",
      panel: "thinking-details",
    });
  });
});
