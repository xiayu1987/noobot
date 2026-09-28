/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { useMessagePreview } from "../../../../../../src/modules/chat/composables/message/useMessagePreview.js";
import { mountComposable } from "../../../../fixtures/mountComposable.js";

const mountedComposables = [];

function createMessagePreview(options) {
  const mounted = mountComposable(() => useMessagePreview(options));
  mountedComposables.push(mounted);
  return mounted.result;
}

function createBlobResponse() {
  return {
    ok: true,
    status: 200,
    blob: vi.fn(async () => new NodeBlob(["content"], { type: "text/plain" })),
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

  afterEach(() => {
    mountedComposables.splice(0).forEach(({ unmount }) => unmount());
    vi.unstubAllGlobals();
  });

  it.each(["browser", "desktop"])(
    "downloads an attachment using its canonical identity on %s",
    async (platform) => {
      const saveDownload = vi.fn().mockResolvedValue({ ok: true, filePath: "/saved/report.txt" });
      if (platform === "desktop") vi.stubGlobal("noobotDesktop", { saveDownload });
      const attachmentService = createAttachmentService(createBlobResponse);
      const { onDownloadAttachment } = createMessagePreview({ userId: "admin", attachmentService });

      await onDownloadAttachment({
        attachmentId: "file-123",
        sessionId: "session-456",
        attachmentSource: "upload",
        name: "report.txt",
      });

      expect(attachmentService.fetchUrl).toHaveBeenCalledTimes(1);
      expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
        "/api/internal/attachment/admin/file-123?sessionId=session-456&attachmentSource=upload",
      );
      if (platform === "desktop") {
        expect(saveDownload).toHaveBeenCalledTimes(1);
        const { fileName, bytes } = saveDownload.mock.calls[0][0];
        expect(fileName).toBe("report.txt");
        expect(new TextDecoder().decode(bytes)).toBe("content");
        expect(URL.createObjectURL).not.toHaveBeenCalled();
        expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
      } else {
        expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment");
      }
    },
  );

  it("saves a desktop workspace link using the authorized response and server filename", async () => {
    const saveDownload = vi.fn().mockResolvedValue({ ok: true });
    const downloadHostFile = vi.fn();
    vi.stubGlobal("noobotDesktop", { saveDownload, downloadHostFile });
    const response = createBlobResponse();
    response.headers = new Headers({
      "content-disposition": "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.txt",
    });
    const attachmentService = { downloadWorkspaceFile: vi.fn().mockResolvedValue(response) };
    const notify = vi.fn();
    const preview = createMessagePreview({ userId: "admin", attachmentService, notify });

    await preview.onDownloadWorkspacePath("runtime/tool-test/fixture.txt");

    expect(attachmentService.downloadWorkspaceFile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin",
        path: "runtime/tool-test/fixture.txt",
      }),
    );
    expect(saveDownload).toHaveBeenCalledTimes(1);
    expect(saveDownload.mock.calls[0][0].fileName).toBe("报告.txt");
    expect(new TextDecoder().decode(saveDownload.mock.calls[0][0].bytes)).toBe("content");
    expect(downloadHostFile).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(["canceled", "failed", "rejected"])(
    "handles a %s desktop save without starting another download",
    async (outcome) => {
      const saveDownload = vi.fn();
      if (outcome === "rejected") saveDownload.mockRejectedValue(new Error("Disk is full"));
      else
        saveDownload.mockResolvedValue(
          outcome === "canceled"
            ? { ok: false, canceled: true }
            : { ok: false, error: "Disk is full" },
        );
      vi.stubGlobal("noobotDesktop", { saveDownload });
      const attachmentService = createAttachmentService(createBlobResponse);
      const notify = vi.fn();
      const preview = createMessagePreview({ userId: "admin", attachmentService, notify });

      await preview.onDownloadAttachment({
        attachmentId: "file-123",
        sessionId: "session-456",
        attachmentSource: "model",
        name: "report.txt",
      });

      expect(saveDownload).toHaveBeenCalledTimes(1);
      if (outcome === "canceled") expect(notify).not.toHaveBeenCalled();
      else expect(notify).toHaveBeenCalledWith({ type: "error", message: "Disk is full" });
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
    },
  );

  it("treats the native host file save cancellation as cancellation", async () => {
    const downloadHostFile = vi.fn().mockResolvedValue({ ok: false, canceled: true });
    vi.stubGlobal("noobotDesktop", { downloadHostFile });
    const notify = vi.fn();
    const preview = createMessagePreview({ userId: "admin", attachmentService: {}, notify });

    await preview.onDownloadFile({
      isSandbox: false,
      hostPath: "/host/report.txt",
      fileName: "report.txt",
    });

    expect(downloadHostFile).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("rejects a non-canonical attachment instead of constructing an access URL", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const { onDownloadAttachment } = createMessagePreview({ userId: "admin", attachmentService });

    await expect(
      onDownloadAttachment({
        name: "missing-id.txt",
        mimeType: "text/plain",
        previewUrl: "https://attacker.example/file",
        downloadUrl: "/api/internal/unrelated",
      }),
    ).rejects.toThrow("invalid_attachment_id");

    expect(attachmentService.fetchUrl).not.toHaveBeenCalled();
  });

  it("keeps multimodal generated attachment download parameters", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const { onDownloadAttachment } = createMessagePreview({ userId: "admin", attachmentService });

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
    const preview = createMessagePreview({ userId: "admin", attachmentService });
    const attachment = {
      attachmentId: "generated-image",
      sessionId: "session-1",
      attachmentSource: "model",
      name: "generated.jfif",
      mimeType: "",
    };

    expect(preview.canPreviewAttachment(attachment)).toBe(true);

    await preview.openAttachmentPreview(attachment);

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/generated-image?sessionId=session-1&attachmentSource=model",
    );
    expect(preview.attachmentPreviewVisible.value).toBe(true);
    expect(preview.attachmentPreviewType.value).toBe("image");
    expect(preview.attachmentPreviewUrl.value).toBe("blob:attachment");
  });

  it("previews text attachments by extension when mime type is octet-stream", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("hello\nworld"));
    const preview = createMessagePreview({ userId: "admin", attachmentService });
    const attachment = {
      attachmentId: "report-log",
      sessionId: "session-1",
      attachmentSource: "model",
      name: "report.log",
      mimeType: "application/octet-stream",
    };

    expect(preview.canPreviewAttachment(attachment)).toBe(true);

    await preview.openAttachmentPreview(attachment);

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/report-log?sessionId=session-1&attachmentSource=model",
    );
    expect(preview.attachmentPreviewVisible.value).toBe(true);
    expect(preview.attachmentPreviewType.value).toBe("text");
    expect(preview.attachmentPreviewTextContent.value).toBe("hello\nworld");
  });

  it("previews a parsed result from its canonical attachment relation", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("# parsed"));
    const preview = createMessagePreview({ userId: "admin", attachmentService });
    const attachment = {
      attachmentId: "source-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 2 * 1024 * 1024,
      relations: [
        {
          relationType: "parsed_result",
          sourceIdentity: {
            attachmentId: "source-1",
            sessionId: "session-1",
            attachmentSource: "upload",
          },
          targetIdentity: {
            attachmentId: "parsed-1",
            sessionId: "session-1",
            attachmentSource: "model",
          },
          name: "report.md",
          mimeType: "text/markdown",
          size: 256,
          createdAt: "2026-08-16T00:00:00.000Z",
        },
      ],
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
    const attachmentService = createAttachmentService(() =>
      createTextResponse("# parsed from office"),
    );
    const preview = createMessagePreview({ userId: "admin", attachmentService });

    await preview.openAttachmentPreview({
      attachmentId: "source-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      name: "report.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      relations: [
        {
          relationType: "parsed_result",
          sourceIdentity: {
            attachmentId: "source-1",
            sessionId: "session-1",
            attachmentSource: "upload",
          },
          targetIdentity: {
            attachmentId: "parsed-1",
            sessionId: "session-1",
            attachmentSource: "model",
          },
          name: "report.md",
          mimeType: "text/markdown",
          createdAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
    );
    expect(preview.attachmentPreviewType.value).toBe("markdown");
    expect(preview.attachmentPreviewTextContent.value).toBe("# parsed from office");
  });

  it("downloads a parsed result from its canonical attachment relation", async () => {
    const attachmentService = createAttachmentService(createBlobResponse);
    const { onDownloadParsedResult } = createMessagePreview({ userId: "admin", attachmentService });

    await onDownloadParsedResult({
      attachmentId: "source-1",
      sessionId: "session-1",
      attachmentSource: "upload",
      relations: [
        {
          relationType: "parsed_result",
          sourceIdentity: {
            attachmentId: "source-1",
            sessionId: "session-1",
            attachmentSource: "upload",
          },
          targetIdentity: {
            attachmentId: "parsed-1",
            sessionId: "session-1",
            attachmentSource: "model",
          },
          name: "report.md",
          mimeType: "text/markdown",
          createdAt: "2026-08-16T00:00:00.000Z",
        },
      ],
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
    );
  });

  it("previews an already-resolved attachment payload through the resolved preview entrypoint", async () => {
    const attachmentService = createAttachmentService(() => createTextResponse("# parsed payload"));
    const preview = createMessagePreview({ userId: "admin", attachmentService });

    await preview.openResolvedAttachmentPreview({
      attachmentId: "parsed-1",
      sessionId: "session-1",
      attachmentSource: "model",
      name: "report.md",
      mimeType: "text/markdown",
      previewUrl: "/api/attachments/parsed-1",
    });

    expect(attachmentService.fetchUrl).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/parsed-1?sessionId=session-1&attachmentSource=model",
    );
    expect(preview.attachmentPreviewVisible.value).toBe(true);
    expect(preview.attachmentPreviewType.value).toBe("markdown");
    expect(preview.attachmentPreviewTextContent.value).toBe("# parsed payload");
  });
});
