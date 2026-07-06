import { describe, expect, it } from "vitest";
import { mergeAttachments } from "../../../../src/composables/infra/dialogProcessChain";

describe("dialogProcessChain.mergeAttachments", () => {
  it("merges a local raw attachment with parsed detail attachment by stable file identity", () => {
    const localAttachment = {
      name: "a.txt",
      mimeType: "text/plain",
      size: 1,
      previewUrl: "blob:local-a",
    };
    const parsedAttachment = {
      name: "a.txt",
      mimeType: "text/plain",
      attachmentId: "server-a",
      downloadUrl: "/api/attachments/server-a/download",
      parsedResultUrl: "/api/attachments/server-a/parsed",
      parsedResultName: "a.md",
    };

    const merged = mergeAttachments([localAttachment], [parsedAttachment]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(expect.objectContaining({
      name: "a.txt",
      mimeType: "text/plain",
      size: 1,
      previewUrl: "blob:local-a",
      attachmentId: "server-a",
      downloadUrl: "/api/attachments/server-a/download",
      parsedResultUrl: "/api/attachments/server-a/parsed",
      parsedResultName: "a.md",
    }));
  });

  it("keeps parsed preview fields when an edited resend payload carries only basic attachment metadata", () => {
    const parsedAttachment = {
      attachmentId: "server-a",
      name: "a.txt",
      mimeType: "text/plain",
      size: 1,
      downloadUrl: "/api/attachments/server-a/download",
      parsedResultUrl: "/api/attachments/server-a/parsed",
      parsedResultName: "a.md",
    };
    const resendAttachment = {
      name: "a.txt",
      mimeType: "text/plain",
      contentBase64: "YQ==",
    };

    const merged = mergeAttachments([parsedAttachment], [resendAttachment]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(expect.objectContaining({
      attachmentId: "server-a",
      name: "a.txt",
      mimeType: "text/plain",
      downloadUrl: "/api/attachments/server-a/download",
      parsedResultUrl: "/api/attachments/server-a/parsed",
      parsedResultName: "a.md",
      contentBase64: "YQ==",
    }));
  });
});
