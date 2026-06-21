/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessagePreview } from "../../../../src/composables/message/useMessagePreview";

function createBlobResponse() {
  return {
    ok: true,
    status: 200,
    blob: vi.fn(async () => new Blob(["content"], { type: "text/plain" })),
  };
}

describe("useMessagePreview attachment downloads", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:attachment");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("downloads attachment using compatible file/session/source fields", async () => {
    const authFetch = vi.fn(async () => createBlobResponse());
    const { onDownloadAttachment } = useMessagePreview({ userId: "admin", authFetch });

    await onDownloadAttachment({
      fileId: "file-123",
      session_id: "session-456",
      source: "upload",
      name: "report.txt",
    });

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/file-123?sessionId=session-456&attachmentSource=upload",
    );
  });

  it("does not request an empty attachment url when attachment id is missing", async () => {
    const authFetch = vi.fn(async () => createBlobResponse());
    const { onDownloadAttachment } = useMessagePreview({ userId: "admin", authFetch });

    await onDownloadAttachment({
      name: "missing-id.txt",
      mimeType: "text/plain",
    });

    expect(authFetch).not.toHaveBeenCalled();
  });

  it("keeps multimodal generated attachment download parameters", async () => {
    const authFetch = vi.fn(async () => createBlobResponse());
    const { onDownloadAttachment } = useMessagePreview({ userId: "admin", authFetch });

    await onDownloadAttachment({
      attachmentId: "ae2d2a3b-8d28-4cc5-b4d8-a819bfd26563",
      sessionId: "8d83a95d-5ab9-413b-b73b-39b90e1ad558",
      attachmentSource: "model",
      name: "generated.png",
    });

    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(authFetch).toHaveBeenCalledWith(
      "/api/internal/attachment/admin/ae2d2a3b-8d28-4cc5-b4d8-a819bfd26563?sessionId=8d83a95d-5ab9-413b-b73b-39b90e1ad558&attachmentSource=model",
    );
  });
});
