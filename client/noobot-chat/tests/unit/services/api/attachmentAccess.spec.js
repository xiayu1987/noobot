import { describe, expect, it } from "vitest";

import {
  buildParsedResultPreviewItem,
  resolveAttachmentAccessMeta,
  resolveParsedResultAccessMeta,
} from "../../../../src/services/api/attachmentAccess.js";

describe("attachmentAccess", () => {
  it("preserves explicit source attachment access urls", () => {
    expect(
      resolveAttachmentAccessMeta(
        {
          attachmentId: "file-1",
          sessionId: "session-1",
          attachmentSource: "upload",
          previewUrl: "/legacy-preview",
        },
        { userId: "admin" },
      ),
    ).toMatchObject({
      attachmentId: "file-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      url: "/legacy-preview",
    });
  });

  it("builds source attachment access urls from attachment identity when explicit urls are missing", () => {
    expect(
      resolveAttachmentAccessMeta(
        {
          attachmentId: "file-1",
          sessionId: "session-1",
          attachmentSource: "upload",
        },
        { userId: "admin" },
      ),
    ).toMatchObject({
      attachmentId: "file-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      url: "/api/internal/attachment/admin/file-1?sessionId=session-1&attachmentSource=upload",
    });
  });

  it("resolves parsed result access from nested attachment metadata", () => {
    const meta = resolveParsedResultAccessMeta(
      {
        attachmentId: "source-1",
        sessionId: "session-1",
        attachmentSource: "upload",
        parsedResult: {
          attachmentId: "parsed-1",
          attachmentSource: "model",
          relativePath: "parsed/report.md",
          mimeType: "text/markdown",
          size: 512,
        },
      },
      { userId: "admin" },
    );

    expect(meta).toMatchObject({
      attachmentId: "parsed-1",
      sessionId: "session-1",
      attachmentSource: "model",
      relativePath: "parsed/report.md",
      url: "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
      name: "report.md",
      mimeType: "text/markdown",
      size: 512,
      hasIdentity: true,
    });
  });

  it("uses explicit parsed result urls when no parsed attachment id exists", () => {
    expect(
      resolveParsedResultAccessMeta({
        parsedResultUrl: "/api/parsed/result",
        parsedResultName: "result.md",
      }),
    ).toMatchObject({
      attachmentId: "",
      url: "/api/parsed/result",
      name: "result.md",
      hasIdentity: true,
    });
  });

  it("builds preview items from parsed result size and type, not source attachment size", () => {
    expect(
      buildParsedResultPreviewItem({
        name: "source.docx",
        size: 2 * 1024 * 1024,
        parsedResult: {
          attachmentId: "parsed-1",
          name: "source.md",
          mimeType: "text/markdown",
          size: 256,
        },
      }),
    ).toMatchObject({
      attachmentId: "parsed-1",
      name: "source.md",
      mimeType: "text/markdown",
      size: 256,
    });
  });
});
