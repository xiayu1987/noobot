/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_EVENT_TYPE,
  ATTACHMENT_LIFECYCLE,
  ATTACHMENT_RELATION_TYPE,
  createAttachmentLifecycleEvent,
} from "@noobot/attachment-protocol";
import {
  handleAttachmentLifecycleStreamEvent,
  handleDeltaStreamEvent,
  handleDoneStreamEvent,
} from "../../../../../../src/modules/chat/runtime/engine/streamHandlers.js";
import { buildViewMessage } from "../../../../../../src/modules/chat/model/messageModel.js";

describe("chatEngine streamHandlers transport boundary", () => {
  const identity = {
    attachmentId: "source-att",
    sessionId: "session-1",
    attachmentSource: "user",
  };
  const relation = {
    relationType: ATTACHMENT_RELATION_TYPE.PARSED_RESULT,
    sourceIdentity: identity,
    targetIdentity: {
      attachmentId: "parsed-att",
      sessionId: "session-1",
      attachmentSource: "model",
    },
    name: "source.md",
    mimeType: "text/markdown",
    createdAt: "2026-08-16T00:00:00.000Z",
  };
  const parsedEvent = (overrides = {}) => createAttachmentLifecycleEvent({
    eventType: ATTACHMENT_EVENT_TYPE.PARSED,
    eventVersion: 1,
    messageId: "attachment-event-1",
    identity,
    status: ATTACHMENT_LIFECYCLE.PARSED,
    occurredAt: "2026-08-16T00:00:00.000Z",
    turnScopeId: "client-turn:parsed-test",
    relation,
    ...overrides,
  });

  it("projects a parsed-result relation onto the canonical user attachment", () => {
    const userMessage = {
      role: "user",
      attachments: [{ ...identity, name: "source.docx" }],
    };
    handleAttachmentLifecycleStreamEvent({
      data: parsedEvent(),
      activeSession: { value: { messages: [userMessage] } },
    });
    expect(userMessage.attachments[0].attachmentLifecycle.status).toBe(ATTACHMENT_LIFECYCLE.PARSED);
    expect(userMessage.attachments[0].relations).toEqual([relation]);
  });

  it("uses the stable identity and does not infer ownership from client draft ids", () => {
    const userMessage = {
      role: "user",
      attachments: [{ ...identity, clientAttachmentId: "draft-client-id" }],
    };
    handleAttachmentLifecycleStreamEvent({
      data: parsedEvent(),
      activeSession: { value: { messages: [userMessage] } },
    });
    expect(userMessage.attachments[0].relations).toEqual([relation]);
  });

  it("does not project lifecycle facts onto a draft without canonical identity", () => {
    const userMessage = {
      role: "user",
      attachments: [{ clientAttachmentId: "draft-attachment:1", name: "source.docx" }],
    };
    handleAttachmentLifecycleStreamEvent({
      data: parsedEvent(),
      activeSession: { value: { messages: [userMessage] } },
    });
    expect(userMessage.attachments[0]).toEqual({
      clientAttachmentId: "draft-attachment:1",
      name: "source.docx",
    });
  });

  it("rejects invalid lifecycle data instead of silently dropping protocol violations", () => {
    expect(() => handleAttachmentLifecycleStreamEvent({
      data: { eventType: ATTACHMENT_EVENT_TYPE.PARSED },
      activeSession: { value: { messages: [] } },
    })).toThrow();
  });

  it("uses the same relation projection during a live run and hydration", () => {
    const makeViewMessage = (message) => buildViewMessage(message, { userId: "user-1" });
    const userMessage = makeViewMessage({
      role: "user",
      sessionId: "session-1",
      attachments: [{
        ...identity,
        name: "source.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }],
    });

    handleAttachmentLifecycleStreamEvent({
      data: parsedEvent(),
      activeSession: { value: { messages: [userMessage] } },
      makeViewMessage,
    });

    expect(userMessage.attachments[0]).toMatchObject({
      sessionId: "session-1",
      attachmentSource: "user",
      relations: [relation],
    });
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
