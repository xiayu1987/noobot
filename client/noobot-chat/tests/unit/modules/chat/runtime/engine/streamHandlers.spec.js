/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  handleAttachmentParsedStreamEvent,
  handleDeltaStreamEvent,
  handleDoneStreamEvent,
} from "../../../../../../src/modules/chat/runtime/engine/streamHandlers.js";

describe("chatEngine streamHandlers transport boundary", () => {
  it("merges parsed attachment metadata into the canonical user attachment", () => {
    const userMessage = {
      role: "user",
      attachments: [{ attachmentId: "source-att", name: "source.docx" }],
    };
    handleAttachmentParsedStreamEvent({
      data: { attachments: [{ attachmentId: "source-att", parsedResult: { text: "parsed" } }] },
      activeSession: { value: { messages: [userMessage] } },
      botMessage: { role: "assistant", attachments: [] },
    });
    expect(userMessage.attachments[0].parsedResult).toEqual({ text: "parsed" });
  });

  it("appends semantic delta text without creating timeline facts", () => {
    const botMessage = { content: "", toolTimeline: [], activityTimeline: [] };
    handleDeltaStreamEvent({ data: { text: "hello" }, botMessage });
    expect(botMessage.content).toBe("hello");
    expect(botMessage.toolTimeline).toEqual([]);
    expect(botMessage.activityTimeline).toEqual([]);
  });

  it("does not synthesize done execution logs into message timelines", () => {
    const botMessage = { content: "answer", toolTimeline: [], activityTimeline: [] };
    handleDoneStreamEvent({
      data: { executionLogs: [{ event: "tool_result", text: "legacy result" }] },
      botMessage,
      activeSession: { value: { loaded: false } },
      clearPendingInteraction: vi.fn(),
      navigateOnFirstResponseOnce: vi.fn(),
      locateSendingStartedMessageOnce: vi.fn(),
    });
    expect(botMessage.toolTimeline).toEqual([]);
    expect(botMessage.activityTimeline).toEqual([]);
  });
});
