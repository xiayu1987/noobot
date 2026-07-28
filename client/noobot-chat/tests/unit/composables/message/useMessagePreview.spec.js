/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessagePreview } from "../../../../src/modules/chat/composables/message/useMessagePreview.js";

function createBlobResponse() {
  return {
    ok: true,
    status: 200,
    blob: vi.fn(async () => new Blob(["content"], { type: "text/plain" })),
  };
}

function createTextResponse(text = "content") {
  return {
    ok: true,
    status: 200,
    text: vi.fn(async () => text),
  };
}

describe("useMessagePreview attachment downloads", () => {
  function createAttachmentService(responseFactory) {
    return { fetchUrl: vi.fn(async () => responseFactory()) };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:attachment");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("downloads attachment using compatible file/session/source fields", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const { onDownloadAttachment } = useMessagePreview({ userId: "admin", attachmentService });

    await onDownloadAttachment({
      fileId: "file-123",
      session_id: "session-456",
      source: "upload",
      name: "report.txt",
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledTimes(1);
    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/file-123?sessionId=session-456&attachmentSource=upload",
    );
  });

  it("does not request an empty attachment url when attachment id is missing", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const { onDownloadAttachment } = useMessagePreview({ userId: "admin", attachmentService });

    await onDownloadAttachment({
      name: "missing-id.txt",
      mimeType: "text/plain",
      previewUrl: "https://attacker.example/file",
      downloadUrl: "/api/internal/unrelated",
    });

    expect(attachmentService.fetchUrl).not.toHaveBeenCalled();
  });

  it("keeps multimodal generated attachment download parameters", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const { onDownloadAttachment } = useMessagePreview({ userId: "admin", attachmentService });

    await onDownloadAttachment({
      attachmentId: "ae2d2a3b-8d28-4cc5-b4d8-a819bfd26563",
      sessionId: "8d83a95d-5ab9-413b-b73b-39b90e1ad558",
      attachmentSource: "model",
      name: "generated.png",
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledTimes(1);
    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/ae2d2a3b-8d28-4cc5-b4d8-a819bfd26563?sessionId=8d83a95d-5ab9-413b-b73b-39b90e1ad558&attachmentSource=model",
    );
  });

  it("previews image attachments by extension when mime type is missing", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const preview = useMessagePreview({ userId: "admin", attachmentService });
    const attachment = {
      attachmentId: "generated-image",
      name: "generated.jfif",
      mimeType: "",
    };

    expect(preview.canPreviewAttachment(attachment)).toBe(true);

    await preview.openAttachmentPreview(attachment);

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith("/api/internal/attachment/admin/generated-image");
    expect(preview.attachmentPreviewVisible.value).toBe(true);
    expect(preview.attachmentPreviewType.value).toBe("image");
    expect(preview.attachmentPreviewUrl.value).toBe("blob:attachment");
  });

  it("previews text attachments by extension when mime type is octet-stream", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("hello\nworld"));
    const preview = useMessagePreview({ userId: "admin", attachmentService });
    const attachment = {
      attachmentId: "report-log",
      name: "report.log",
      mimeType: "application/octet-stream",
    };

    expect(preview.canPreviewAttachment(attachment)).toBe(true);

    await preview.openAttachmentPreview(attachment);

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith("/api/internal/attachment/admin/report-log");
    expect(preview.attachmentPreviewVisible.value).toBe(true);
    expect(preview.attachmentPreviewType.value).toBe("text");
    expect(preview.attachmentPreviewTextContent.value).toBe("hello\nworld");
  });

  it("previews parsed result from nested attachment metadata when parsedResultUrl is missing", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("# parsed"));
    const preview = useMessagePreview({ userId: "admin", attachmentService });
    const attachment = {
      attachmentId: "source-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 2 * 1024 * 1024,
      parsedResult: {
        attachmentId: "parsed-1",
        sessionId: "session-1",
        attachmentSource: "model",
        name: "report.md",
        mimeType: "text/markdown",
        size: 256,
      },
    };

    expect(preview.canPreviewAttachment(attachment)).toBe(false);
    expect(preview.canPreviewParsedResult(attachment)).toBe(true);

    await preview.openParsedResultPreview(attachment);

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
    );
    expect(preview.attachmentPreviewVisible.value).toBe(true);
    expect(preview.attachmentPreviewType.value).toBe("markdown");
    expect(preview.attachmentPreviewName.value).toBe("report.md");
    expect(preview.attachmentPreviewTextContent.value).toBe("# parsed");
  });

  it("source attachment preview delegates office attachments to parsed result preview", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("# parsed from office"));
    const preview = useMessagePreview({ userId: "admin", attachmentService });

    await preview.openAttachmentPreview({
      attachmentId: "source-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      parsedResult: {
        attachmentId: "parsed-1",
        sessionId: "session-1",
        attachmentSource: "model",
        name: "report.md",
      },
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
    );
    expect(preview.attachmentPreviewType.value).toBe("markdown");
    expect(preview.attachmentPreviewTextContent.value).toBe("# parsed from office");
  });

  it("downloads parsed result from nested attachment metadata", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const { onDownloadParsedResult } = useMessagePreview({ userId: "admin", attachmentService });

    await onDownloadParsedResult({
      sessionId: "session-1",
      parsedResult: {
        attachmentId: "parsed-1",
        sessionId: "session-1",
        attachmentSource: "model",
        name: "report.md",
      },
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
    );
  });

  it("previews an already-resolved attachment payload through the resolved preview entrypoint", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("# parsed payload"));
    const preview = useMessagePreview({ userId: "admin", attachmentService });

    await preview.openResolvedAttachmentPreview({
      attachmentId: "parsed-1",
      name: "report.md",
      mimeType: "text/markdown",
      previewUrl: "/api/attachments/parsed-1",
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith("/api/internal/attachment/admin/parsed-1");
    expect(preview.attachmentPreviewVisible.value).toBe(true);
    expect(preview.attachmentPreviewType.value).toBe("markdown");
    expect(preview.attachmentPreviewTextContent.value).toBe("# parsed payload");
  });

  it("keeps legacy parsedResult option compatible for resolved attachment payloads", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("# compat payload"));
    const preview = useMessagePreview({ userId: "admin", attachmentService });

    await preview.openAttachmentPreview(
      {
        attachmentId: "parsed-1",
        name: "report.md",
        mimeType: "text/markdown",
        previewUrl: "/api/attachments/parsed-1",
      },
      { parsedResult: true },
    );

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith("/api/internal/attachment/admin/parsed-1");
    expect(preview.attachmentPreviewType.value).toBe("markdown");
    expect(preview.attachmentPreviewTextContent.value).toBe("# compat payload");
  });
});
