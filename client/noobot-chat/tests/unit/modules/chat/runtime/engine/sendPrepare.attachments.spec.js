/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { AGENT_COMMAND } from "@noobot/agent-transport-protocol";
import { prepareChatSend } from "../../../../../../src/modules/chat/runtime/engine/sendPrepare.js";
import { resolveMessageViewKey } from "@noobot/event-protocol/message-event";
import { RoleEnum } from "../../../../../../src/modules/chat/model/chatConstants.js";

function createPrepareHarness({ existingMessages = [] } = {}) {
  const activeSession = {
    value: {
      id: "session-a",
      sessionId: "session-a",
      title: "Existing title",
      messages: existingMessages,
    },
  };
  const appended = [];
  const appendMessage = vi.fn((role, content, attachments = []) => {
    const message = { role, content, attachments };
    activeSession.value.messages.push(message);
    appended.push(message);
    return message;
  });
  const upsertCanonicalAssistantMessage = vi.fn((presentationMessageId, identity = {}) => {
    const existing = activeSession.value.messages.find(
      (message) => resolveMessageViewKey(message) === presentationMessageId,
    );
    if (existing) return existing;
    const message = {
      role: RoleEnum.ASSISTANT,
      content: "",
      ...identity,
      presentationMessageId,
    };
    activeSession.value.messages.push(message);
    return message;
  });
  return {
    input: { value: "" },
    activeSession,
    appendMessage,
    upsertCanonicalAssistantMessage,
    appended,
    translate: vi.fn((key) => key),
    navigateToLastMessage: vi.fn(),
    isImageMime: vi.fn(() => false),
  };
}

function resendRequest(overrides) {
  return {
    commandType: AGENT_COMMAND.RESEND,
    sessionId: "session-a",
    dialogProcessId: "dialog-resend",
    presentationMessageId: "msg-assistant-resend",
    ...overrides,
  };
}

describe("prepareChatSend attachment architecture", () => {
  it("renders the resolved message text and keeps the default title for attachment-only input", () => {
    const harness = createPrepareHarness();
    harness.activeSession.value.title = "chat.newSession";
    const result = prepareChatSend({
      ...harness,
      request: {
        commandType: AGENT_COMMAND.SEND,
        sessionId: "session-a",
        turnScopeId: "client-turn:upload-only",
        userMessageId: "msg-user-upload-only",
        presentationMessageId: "msg-assistant-upload-only",
        authoredText: "",
        messageText: "chat.uploadHint",
        attachmentFiles: [],
      },
    });
    expect(result.userMessage.content).toBe("chat.uploadHint");
    expect(harness.activeSession.value.title).toBe("chat.newSession");
  });

  it("keeps the draft client identity on the live user-message attachment", () => {
    const harness = createPrepareHarness();
    const uploadEntry = {
      clientAttachmentId: "draft-current",
      raw: { name: "current.docx", type: "application/docx", size: 456 },
      name: "current.docx",
      mimeType: "application/docx",
      size: 456,
    };
    const result = prepareChatSend({
      ...harness,
      request: {
        commandType: AGENT_COMMAND.SEND,
        sessionId: "session-a",
        turnScopeId: "client-turn:current",
        userMessageId: "msg-user-current",
        presentationMessageId: "msg-assistant-current",
        messageText: "parse current attachment",
        attachmentFiles: [uploadEntry],
      },
    });

    expect(result.userMessage.attachments).toEqual([
      expect.objectContaining({
        clientAttachmentId: "draft-current",
        name: "current.docx",
        size: 456,
      }),
    ]);
  });

  it("uses the resend request attachments as authority for the reused user turn", () => {
    const richAttachment = {
      attachmentId: "att-rich",
      attachmentSource: "test",
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 123,
      sessionId: "session-a",
      path: "/workspace/att-rich.docx",
      relativePath: "runtime/attach/session-a/user/att-rich.docx",
      sandboxPath: "/workspace/att-rich.docx",
      previewUrl: "/api/attachments/att-rich/preview",
      downloadUrl: "/api/attachments/att-rich/download",
    };
    const userMessage = {
      role: RoleEnum.USER,
      content: "old",
      userMessageId: "msg-user-reuse",
      turnScopeId: "client-turn:reuse",
      attachments: [richAttachment],
    };
    const harness = createPrepareHarness({ existingMessages: [userMessage] });

    prepareChatSend({
      ...harness,
      request: resendRequest({
        userMessageId: "msg-user-reuse",
        turnScopeId: "client-turn:reuse",
        messageText: "edited",
        attachments: [
          {
            attachmentId: "att-rich",
            sessionId: "session-a",
            attachmentSource: "test",
            name: "report.docx",
            mimeType: richAttachment.mimeType,
            size: 123,
          },
        ],
      }),
    });

    expect(userMessage.attachments).toEqual([
      {
        attachmentId: "att-rich",
        sessionId: "session-a",
        attachmentSource: "test",
        name: "report.docx",
        mimeType: richAttachment.mimeType,
        size: 123,
      },
    ]);
  });

  it("replaces the reused user turn attachments with an empty resend attachment list", () => {
    const userMessage = {
      role: RoleEnum.USER,
      content: "old",
      userMessageId: "msg-user-delete",
      turnScopeId: "client-turn:delete",
      attachments: [
        {
          attachmentId: "old-att",
          sessionId: "session-a",
          attachmentSource: "test",
          name: "old.txt",
        },
      ],
    };
    const harness = createPrepareHarness({ existingMessages: [userMessage] });

    prepareChatSend({
      ...harness,
      request: resendRequest({
        userMessageId: "msg-user-delete",
        turnScopeId: "client-turn:delete",
        messageText: "edited without attachments",
        attachments: [],
      }),
    });

    expect(userMessage.attachments).toEqual([]);
  });
});
