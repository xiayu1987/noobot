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
import { buildViewMessage } from "../../../../../../src/modules/chat/model/messageModel.js";

describe("chatEngine streamHandlers transport boundary", () => {
  it("merges parsed attachment metadata into the canonical user attachment", () => {
    const userMessage = {
      role: "user",
      attachments: [{ attachmentId: "source-att", sessionId: "session-1", attachmentSource: "user", name: "source.docx" }],
    };
    handleAttachmentParsedStreamEvent({
      data: {
        sessionId: "session-1",
        turnScopeId: "client-turn:parsed-basic-test",
        attachments: [{
          attachmentId: "source-att",
          sessionId: "session-1",
          attachmentSource: "user",
          parsedResult: {
            attachmentId: "parsed-att",
            sessionId: "child-session-1",
            attachmentSource: "model",
            text: "parsed",
          },
        }],
      },
      activeSession: { value: { messages: [userMessage] } },
      botMessage: { role: "assistant", attachments: [] },
    });
    expect(userMessage.attachments[0].parsedResult).toMatchObject({
      attachmentId: "parsed-att",
      text: "parsed",
    });
  });

  it("uses canonical identity when client attachment ids differ", () => {
    const userMessage = {
      role: "user",
      attachments: [{
        clientAttachmentId: "draft-client-id",
        attachmentId: "source-att",
        sessionId: "session-1",
        attachmentSource: "user",
      }],
    };
    handleAttachmentParsedStreamEvent({
      data: { sessionId: "session-1", turnScopeId: "client-turn:parsed-test", attachments: [{
        clientAttachmentId: "persisted-client-id",
        attachmentId: "source-att",
        sessionId: "session-1",
        attachmentSource: "user",
        parsedResult: {
          attachmentId: "parsed-att",
          sessionId: "child-session-1",
          attachmentSource: "model",
        },
      }] },
      activeSession: { value: { messages: [userMessage] } },
    });
    expect(userMessage.attachments[0].parsedResult).toMatchObject({ attachmentId: "parsed-att" });
  });

  it("projects parsed metadata onto an upload draft before turn commit", () => {
    const userMessage = {
      role: "user",
      attachments: [{
        clientAttachmentId: "draft-attachment:1",
        name: "source.docx",
      }],
    };
    handleAttachmentParsedStreamEvent({
      data: {
        sessionId: "session-1",
        turnScopeId: "client-turn:parsed-draft-test",
        attachments: [{
          clientAttachmentId: "draft-attachment:1",
          attachmentId: "source-att",
          sessionId: "session-1",
          attachmentSource: "user",
          parsedResult: {
            attachmentId: "parsed-att",
            sessionId: "child-session-1",
            attachmentSource: "model",
          },
        }],
      },
      activeSession: { value: { messages: [userMessage] } },
      makeViewMessage: (message) => message,
    });
    expect(userMessage.attachments[0].parsedResult).toMatchObject({
      attachmentId: "parsed-att",
      sessionId: "child-session-1",
      attachmentSource: "model",
    });
  });

  it("uses the same canonical attachment projection during a live run and hydration", () => {
    const makeViewMessage = (message) => buildViewMessage(message, { userId: "user-1" });
    const userMessage = makeViewMessage({
      role: "user",
      sessionId: "session-1",
      attachments: [{
        attachmentId: "source-att",
        name: "source.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }],
    });

    handleAttachmentParsedStreamEvent({
      data: {
        sessionId: "session-1",
        turnScopeId: "client-turn:parsed-live-test",
        attachments: [{
          attachmentId: "source-att",
          sessionId: "session-1",
          attachmentSource: "user",
          name: "source.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          parsedResult: {
            attachmentId: "parsed-att",
            sessionId: "session-1",
            attachmentSource: "model",
            name: "source.md",
            mimeType: "text/markdown",
          },
        }],
      },
      activeSession: { value: { messages: [userMessage] } },
      makeViewMessage,
    });

    expect(userMessage.attachments[0]).toMatchObject({
      sessionId: "session-1",
      attachmentSource: "user",
      parsedResult: {
        attachmentId: "parsed-att",
        sessionId: "session-1",
        attachmentSource: "model",
      },
    });
    expect(userMessage.attachments[0].parsedResultUrl).toContain("parsed-att");
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
