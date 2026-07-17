/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, it } from "vitest";

import {
  mergeAttachmentMetaFields,
  mergeAttachments,
} from "../../../../src/composables/infra/dialogProcessChain";

describe("dialogProcessChain attachment rich-first merge", () => {
  it("keeps parsed result and preview/download fields when incoming payload is raw", () => {
    const richAttachment = {
      attachmentId: "att-rich",
      sessionId: "session-a",
      attachmentSource: "user",
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 123,
      path: "/workspace/report.docx",
      relativePath: "runtime/attach/scoped/session-a/user/att-rich/report.docx",
      sandboxPath: "/workspace/report.docx",
      previewUrl: "/preview/att-rich",
      downloadUrl: "/download/att-rich",
      parsedResultUrl: "/download/parsed-rich",
      parsedResultName: "report.txt",
      parsedResultAttachmentId: "parsed-rich",
      parsedResult: { attachmentId: "parsed-rich", path: "/workspace/report.txt" },
    };

    const merged = mergeAttachments([richAttachment], [
      { name: "report.docx", mimeType: richAttachment.mimeType, size: 123 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      attachmentId: "att-rich",
      sessionId: "session-a",
      attachmentSource: "user",
      path: richAttachment.path,
      relativePath: richAttachment.relativePath,
      sandboxPath: richAttachment.sandboxPath,
      previewUrl: "/preview/att-rich",
      downloadUrl: "/download/att-rich",
      parsedResultUrl: "/download/parsed-rich",
      parsedResultName: "report.txt",
      parsedResultAttachmentId: "parsed-rich",
      parsedResult: richAttachment.parsedResult,
    });
  });

  it("does not let empty raw fields erase rich display fields", () => {
    const merged = mergeAttachmentMetaFields(
      {
        attachmentId: "att-rich",
        previewUrl: "/preview/att-rich",
        downloadUrl: "/download/att-rich",
        parsedResultUrl: "/download/parsed-rich",
        parsedResult: { attachmentId: "parsed-rich", path: "/workspace/parsed.txt" },
      },
      {
        attachmentId: "",
        previewUrl: "",
        downloadUrl: null,
        parsedResultUrl: undefined,
      },
    );

    expect(merged.attachmentId).toBe("att-rich");
    expect(merged.previewUrl).toBe("/preview/att-rich");
    expect(merged.downloadUrl).toBe("/download/att-rich");
    expect(merged.parsedResultUrl).toBe("/download/parsed-rich");
    expect(merged.parsedResult).toEqual({ attachmentId: "parsed-rich", path: "/workspace/parsed.txt" });
  });

  it("keeps same-name attachments separate when stable metadata differs", () => {
    const existing = [{ attachmentId: "att-docx", name: "report", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 123 }];
    const incoming = [{ name: "report", mimeType: "application/pdf", size: 456 }];

    const merged = mergeAttachments(existing, incoming);

    expect(merged).toHaveLength(2);
    expect(merged[0].attachmentId).toBe("att-docx");
    expect(merged[1]).toEqual(incoming[0]);
  });
});
