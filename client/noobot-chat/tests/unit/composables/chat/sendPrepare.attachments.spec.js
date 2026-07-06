import { describe, expect, it, vi } from "vitest";
import { prepareChatSend } from "../../../../src/composables/chat/chatEngine/sendPrepare";
import { RoleEnum } from "../../../../src/shared/constants/chatConstants";

function createPrepareHarness({ existingMessages = [] } = {}) {
  const activeSession = {
    value: {
      id: "session-a",
      backendSessionId: "session-a",
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
  return {
    input: { value: "" },
    uploadFiles: { value: [] },
    activeSession,
    appendMessage,
    appended,
    applyConversationState: vi.fn(),
    translate: vi.fn((key) => key),
    scrollBottom: vi.fn(),
    isImageMime: vi.fn(() => false),
  };
}

describe("prepareChatSend attachment architecture", () => {
  it("keeps rich user-message attachment fields when reuse turn receives raw userAttachments", () => {
    const richAttachment = {
      attachmentId: "att-rich",
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 123,
      sessionId: "session-a",
      path: "/workspace/att-rich.docx",
      relativePath: "runtime/attach/session-a/user/att-rich.docx",
      sandboxPath: "/workspace/att-rich.docx",
      previewUrl: "/api/attachments/att-rich/preview",
      downloadUrl: "/api/attachments/att-rich/download",
      parsedResult: {
        attachmentId: "parsed-rich",
        path: "/workspace/parsed-rich.md",
        relativePath: "runtime/attach/session-a/model/parsed-rich.md",
      },
      parsedResultAttachmentId: "parsed-rich",
      parsedResultUrl: "/api/attachments/parsed-rich/download",
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
      userAttachments: [{ name: "report.docx", mimeType: richAttachment.mimeType, size: 123 }],
    });

    expect(userMessage.attachments).toHaveLength(1);
    expect(userMessage.attachments[0]).toEqual(expect.objectContaining({
      attachmentId: "att-rich",
      path: "/workspace/att-rich.docx",
      relativePath: "runtime/attach/session-a/user/att-rich.docx",
      sandboxPath: "/workspace/att-rich.docx",
      previewUrl: "/api/attachments/att-rich/preview",
      downloadUrl: "/api/attachments/att-rich/download",
      parsedResultAttachmentId: "parsed-rich",
      parsedResultUrl: "/api/attachments/parsed-rich/download",
    }));
    expect(userMessage.attachments[0].parsedResult).toEqual(expect.objectContaining({
      attachmentId: "parsed-rich",
      path: "/workspace/parsed-rich.md",
    }));
  });

  it("treats explicit empty userAttachments as delete-all instead of restoring old attachments", () => {
    const userMessage = {
      role: RoleEnum.USER,
      content: "old",
      turnScopeId: "client-turn:delete",
      attachments: [{ attachmentId: "old-att", name: "old.txt" }],
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
