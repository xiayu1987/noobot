import { describe, expect, it } from "vitest";
import { buildViewMessage } from "../../../../src/composables/infra/messageModel";

describe("messageModel attachment normalization", () => {
  it("expands nested parsedResult into preview/download fields for office attachments", () => {
    const viewMessage = buildViewMessage(
      {
        role: "user",
        sessionId: "session-a",
        attachments: [
          {
            attachmentId: "source-a",
            name: "AI 体系现状概览.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size: 1407731,
            attachmentSource: "user",
            parsedResult: {
              attachmentId: "parsed-a",
              sessionId: "session-a",
              attachmentSource: "model",
              path: "/workspace/admin/runtime/attach/scoped/session-a/model/parsed-a.md",
              relativePath: "runtime/attach/scoped/session-a/model/parsed-a.md",
            },
          },
        ],
      },
      { userId: "admin" },
    );

    expect(viewMessage.attachments).toHaveLength(1);
    expect(viewMessage.attachments[0]).toEqual(expect.objectContaining({
      attachmentId: "source-a",
      parsedResultAttachmentId: "parsed-a",
      parsedResultPath: "/workspace/admin/runtime/attach/scoped/session-a/model/parsed-a.md",
      parsedResultRelativePath: "runtime/attach/scoped/session-a/model/parsed-a.md",
      parsedResultSessionId: "session-a",
      parsedResultAttachmentSource: "model",
      parsedResultUrl: "/api/internal/attachment/admin/parsed-a?sessionId=session-a&attachmentSource=model",
      parsedResultName: "parsed-a.md",
    }));
    expect(viewMessage.attachments[0].parsedResult).toEqual(expect.objectContaining({
      attachmentId: "parsed-a",
      sessionId: "session-a",
      attachmentSource: "model",
    }));
  });
});
