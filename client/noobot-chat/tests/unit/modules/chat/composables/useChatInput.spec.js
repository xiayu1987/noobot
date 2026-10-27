/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../../../src/modules/chat/stores/useChatStore.js";
import { useChatInput } from "../../../../../src/modules/chat/composables/useChatInput.js";

describe("useChatInput", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useChatStore();
    store.resetChatStore();
  });

  it("keeps native File entries from upload change and serializes non-empty base64", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const { uploadFiles, appendUploads, serializeAttachments } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });

    appendUploads([file]);

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0]).toMatchObject({
      clientAttachmentId: expect.any(String),
      raw: file,
      name: "hello.txt",
      mimeType: "text/plain",
      size: 5,
    });

    const attachments = await serializeAttachments(uploadFiles.value);
    expect(attachments).toEqual([
      {
        clientAttachmentId: uploadFiles.value[0].clientAttachmentId,
        name: "hello.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
      },
    ]);
    expect(attachments[0].contentBase64).not.toBe("");
  });

  it("adds a selected file without depending on a component file list", async () => {
    const file = new File(["single"], "single.txt", { type: "text/plain" });
    const { uploadFiles, appendUploads, serializeAttachments } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });

    appendUploads([file]);

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0]).toMatchObject({
      raw: file,
      name: "single.txt",
      mimeType: "text/plain",
      size: 6,
    });

    const attachments = await serializeAttachments(uploadFiles.value);
    expect(attachments[0]).toMatchObject({
      name: "single.txt",
      mimeType: "text/plain",
      contentBase64: "c2luZ2xl",
    });
  });

  it("dedupes the same selected file when upload change receives duplicate entries", () => {
    const file = new File(["dupe"], "dupe.txt", {
      type: "text/plain",
      lastModified: 123,
    });
    const uploadItem = { name: "dupe.txt", raw: file, size: file.size };
    const { uploadFiles, appendUploads } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });

    appendUploads([uploadItem, file]);

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0].name).toBe("dupe.txt");
  });

  it("does not restore a removed attachment from the upload component stale file list", () => {
    const removed = new File(["old"], "old.txt", { type: "text/plain", lastModified: 1 });
    const added = new File(["new"], "new.txt", { type: "text/plain", lastModified: 2 });
    const removedItem = { name: "old.txt", raw: removed, size: removed.size };
    const addedItem = { name: "new.txt", raw: added, size: added.size };
    const { uploadFiles, appendUploads, removeUpload } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });

    appendUploads([removedItem]);
    removeUpload(uploadFiles.value[0].clientAttachmentId);
    expect(uploadFiles.value).toEqual([]);

    appendUploads([addedItem]);

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0]).toMatchObject({ name: "new.txt", raw: added });
  });

  it("rejects removeUpload without a clientAttachmentId instead of ignoring it", () => {
    const kept = new File(["keep"], "keep.txt", { type: "text/plain", lastModified: 3 });
    const { uploadFiles, appendUploads, removeUpload } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });
    appendUploads([kept]);

    expect(() => removeUpload()).toThrow("removeUpload requires clientAttachmentId");
    expect(() => removeUpload("")).toThrow(TypeError);
    expect(uploadFiles.value).toHaveLength(1);
  });

  it("leaves the upload list unchanged when removeUpload receives an unknown clientAttachmentId", () => {
    const kept = new File(["keep"], "keep.txt", { type: "text/plain", lastModified: 4 });
    const { uploadFiles, appendUploads, removeUpload } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });
    appendUploads([kept]);

    removeUpload("draft-attachment:unknown");

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0].name).toBe("keep.txt");
  });

  it("keeps Element Plus upload items from upload change and serializes non-empty base64", async () => {
    const file = new File(["world"], "world.txt", { type: "text/plain" });
    const uploadItem = { name: "world.txt", raw: file, size: file.size };
    const { uploadFiles, appendUploads, serializeAttachments } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });

    appendUploads([uploadItem]);

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0].raw).toBe(file);

    const attachments = await serializeAttachments(uploadFiles.value);
    expect(attachments[0]).toMatchObject({
      name: "world.txt",
      mimeType: "text/plain",
      contentBase64: "d29ybGQ=",
    });
  });

  it("can serialize an upload entry whose raw file is absent but entry is a File-compatible object", async () => {
    const file = new File(["fallback"], "fallback.txt", { type: "text/plain" });
    const { serializeAttachments } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });

    const attachments = await serializeAttachments([
      { clientAttachmentId: "client-1", ...file, name: file.name, mimeType: file.type, raw: file },
    ]);
    const expectedBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

    expect(attachments[0].contentBase64).toBe(expectedBase64);
    expect(attachments[0].contentBase64).not.toBe("");
  });

  it("serializeAttachments rejects an upload entry without clientAttachmentId", () => {
    const file = new File(["x"], "x.txt", { type: "text/plain" });
    const { serializeAttachments } = useChatInput({
      isImageMime: () => false,
      clearUploadSelection: vi.fn(),
    });
    return expect(
      serializeAttachments([{ raw: file, name: "x.txt", mimeType: "text/plain" }]),
    ).rejects.toThrow("serializeAttachments requires clientAttachmentId");
  });

  it("clearUploads releases preview urls, empties the list and clears the file selection", () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:preview-1");
    URL.revokeObjectURL = vi.fn();
    try {
      const clearUploadSelection = vi.fn();
      const { uploadFiles, appendUploads, clearUploads } = useChatInput({
        isImageMime: () => true,
        clearUploadSelection,
      });
      appendUploads([new File(["img"], "a.png", { type: "image/png" })]);
      expect(uploadFiles.value).toHaveLength(1);

      clearUploads();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
      expect(uploadFiles.value).toEqual([]);
      expect(clearUploadSelection).toHaveBeenCalledTimes(1);
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("rejects construction without clearUploadSelection", () => {
    expect(() => useChatInput({ isImageMime: () => false })).toThrow(
      "useChatInput requires function dependencies: clearUploadSelection",
    );
  });
});
