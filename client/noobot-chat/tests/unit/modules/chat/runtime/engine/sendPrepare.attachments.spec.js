/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it, vi } from "vitest";
import { prepareChatSend } from "../../../../../../src/modules/chat/runtime/engine/sendPrepare.js";
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
  const upsertCanonicalAssistantMessage = vi.fn((messageId, identity = {}) => {
    const existing = activeSession.value.messages.find(
      (message) => message.role === RoleEnum.ASSISTANT && message.messageId === messageId,
    );
    if (existing) return existing;
    const message = {
      role: RoleEnum.ASSISTANT,
      content: "",
      messageId,
      ...identity,
    };
    activeSession.value.messages.push(message);
    return message;
  });
  return {
    input: { value: "" },
    uploadFiles: { value: [] },
    activeSession,
    appendMessage,
    upsertCanonicalAssistantMessage,
    appended,
    applyConversationState: vi.fn(),
    translate: vi.fn((key) => key),
    scrollBottom: vi.fn(),
    isImageMime: vi.fn(() => false),
  };
}

describe("prepareChatSend attachment architecture", () => {
  it("keeps the draft client identity on the live user-message attachment", () => {
    const harness = createPrepareHarness();
    const uploadEntry = {
      draftAttachmentId: "draft-current",
      raw: { name: "current.docx", type: "application/docx", size: 456 },
      name: "current.docx",
      mimeType: "application/docx",
      size: 456,
    };
    harness.uploadFiles.value = [uploadEntry];

    const result = prepareChatSend({
      ...harness,
      messageText: "parse current attachment",
      turnScopeId: "client-turn:current",
    });

    expect(result.userMessage.attachments).toEqual([
      expect.objectContaining({
        clientAttachmentId: "draft-current",
        name: "current.docx",
        size: 456,
      }),
    ]);
  });

  it("uses incoming canonical attachments as authority when reusing a user turn", () => {
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
      turnScopeId: "client-turn:reuse",
      attachments: [richAttachment],
    };
    const harness = createPrepareHarness({ existingMessages: [userMessage] });

    prepareChatSend({
      ...harness,
      messageText: "edited",
      turnScopeId: "client-turn:reuse",
      reuseExistingUserTurn: true,
      userAttachments: [
        {
          attachmentId: "att-rich",
          sessionId: "session-a",
          attachmentSource: "test",
          name: "report.docx",
          mimeType: richAttachment.mimeType,
          size: 123,
        },
      ],
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

  it("treats explicit empty userAttachments as delete-all instead of restoring old attachments", () => {
    const userMessage = {
      role: RoleEnum.USER,
      content: "old",
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
      messageText: "edited without attachments",
      turnScopeId: "client-turn:delete",
      reuseExistingUserTurn: true,
      userAttachments: [],
    });

    expect(userMessage.attachments).toEqual([]);
  });
});
