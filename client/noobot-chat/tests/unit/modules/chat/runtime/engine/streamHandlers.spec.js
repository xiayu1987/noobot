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
  attachmentLifecycleSequenceScopeId,
  ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
} from "@noobot/attachment-protocol";
import { createEventEnvelope, EVENT_FAMILY } from "@noobot/event-protocol";
import { handleAttachmentLifecycleStreamEvent } from "../../../../../../src/modules/chat/runtime/engine/streamHandlers.js";
import { normalizeTurnTransportEnvelope } from "../../../../../../src/modules/chat/runtime/engine/turnTransportEnvelope.js";
import { applyReconnectEventReplay } from "../../../../../../src/modules/chat/runtime/reconnect/reconnectEventReplay.js";
import {
  buildViewMessage,
  normalizeMessageAttachments,
} from "../../../../../../src/modules/chat/model/messageModel.js";

const makeViewAttachments = (attachments) =>
  normalizeMessageAttachments(attachments, { userId: "user-1" });

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
  const parsedEvent = (overrides = {}) => {
    const payload = createAttachmentLifecycleEvent({
      eventType: ATTACHMENT_EVENT_TYPE.PARSED,
      eventVersion: 2,
      identity,
      status: ATTACHMENT_LIFECYCLE.PARSED,
      occurredAt: "2026-08-16T00:00:00.000Z",
      turnScopeId: "client-turn:parsed-test",
      relation,
      ...overrides,
    });
    return createEventEnvelope({
      family: EVENT_FAMILY.ATTACHMENT_LIFECYCLE,
      schemaVersion: 2,
      identity: {
        eventId: "evt-parsed-1",
        eventType: "attachment_lifecycle",
        sessionId: identity.sessionId,
        turnScopeId: payload.turnScopeId,
      },
      causality: {},
      ordering: {
        domain: ATTACHMENT_LIFECYCLE_SEQUENCE_DOMAIN,
        scopeId: attachmentLifecycleSequenceScopeId(identity),
        sequence: 1,
      },
      producer: { type: "test", id: "stream-test" },
      occurredAt: payload.occurredAt,
      payload,
    });
  };

  it("projects a parsed-result relation onto the canonical user attachment", () => {
    const userMessage = {
      role: "user",
      attachments: [{ ...identity, name: "source.docx" }],
    };
    handleAttachmentLifecycleStreamEvent({
      data: parsedEvent(),
      activeSession: { value: { messages: [userMessage] } },
      makeViewAttachments,
      logSessionEvent: vi.fn(),
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
      makeViewAttachments,
      logSessionEvent: vi.fn(),
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
      makeViewAttachments,
      logSessionEvent: vi.fn(),
    });
    expect(userMessage.attachments[0]).toEqual({
      clientAttachmentId: "draft-attachment:1",
      name: "source.docx",
    });
  });

  it("rejects invalid lifecycle data instead of silently dropping protocol violations", () => {
    expect(() =>
      handleAttachmentLifecycleStreamEvent({
        data: { eventType: ATTACHMENT_EVENT_TYPE.PARSED },
        activeSession: { value: { messages: [] } },
      }),
    ).toThrow();
  });

  it("deduplicates a persisted authority event across live and reconnect delivery", async () => {
    const incoming = parsedEvent();
    const userMessage = { role: "user", attachments: [{ ...identity }] };
    const context = {
      activeSession: { value: { messages: [userMessage] } },
      makeViewAttachments,
      logSessionEvent: vi.fn(),
    };
    const live = normalizeTurnTransportEnvelope({ event: "attachment_lifecycle", data: incoming });
    handleAttachmentLifecycleStreamEvent({ ...context, data: live.data });
    const state = userMessage.attachments[0].attachmentLifecycle;
    expect(state.events.map((event) => event.identity.eventId)).toEqual(["evt-parsed-1"]);
    const onAttachmentLifecycle = vi.fn((data) => {
      handleAttachmentLifecycleStreamEvent({ ...context, data });
    });
    const result = await applyReconnectEventReplay({
      event: "attachment_lifecycle",
      data: JSON.parse(JSON.stringify(incoming)),
      isDeletedTurn: () => false,
      onAttachmentLifecycle,
    });
    expect(result.applied).toBe(true);
    expect(onAttachmentLifecycle.mock.calls[0][0].identity.eventId).toBe("evt-parsed-1");
    expect(userMessage.attachments[0].attachmentLifecycle).toBe(state);
  });

  it("uses the same relation projection during a live run and hydration", () => {
    const makeViewMessage = (message) =>
      buildViewMessage(message, { sessionId: "session-1", userId: "user-1" });
    const userMessage = makeViewMessage({
      role: "user",
      content: "",
      sessionId: "session-1",
      attachments: [
        {
          ...identity,
          name: "source.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
    });

    handleAttachmentLifecycleStreamEvent({
      data: parsedEvent(),
      activeSession: { value: { messages: [userMessage] } },
      makeViewAttachments,
      logSessionEvent: vi.fn(),
    });

    expect(userMessage.attachments[0]).toMatchObject({
      sessionId: "session-1",
      attachmentSource: "user",
      relations: [relation],
    });
  });
});
