import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useChatStore } from "../../../../src/shared/stores/useChatStore";
import { useChatInput } from "../../../../src/composables/chat/useChatInput";

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

describe("useChatInput", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const store = useChatStore();
    store.resetChatStore();
  });

  it("keeps native File entries from upload change and serializes non-empty base64", async () => {
    const file = new File(["hello"], "hello.txt", { type: "text/plain" });
    const { uploadFiles, onUploadChange, serializeAttachments } = useChatInput({
      isImageMime: () => false,
    });

    onUploadChange(file, [file]);

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0]).toMatchObject({
      raw: file,
      name: "hello.txt",
      mimeType: "text/plain",
      size: 5,
    });

    const attachments = await serializeAttachments(uploadFiles.value);
    expect(attachments).toEqual([
      {
        name: "hello.txt",
        mimeType: "text/plain",
        contentBase64: "aGVsbG8=",
      },
    ]);
    expect(attachments[0].contentBase64).not.toBe("");
  });

  it("uses current file when upload change is called without a file list", async () => {
    const file = new File(["single"], "single.txt", { type: "text/plain" });
    const { uploadFiles, onUploadChange, serializeAttachments } = useChatInput({
      isImageMime: () => false,
    });

    onUploadChange(file, undefined);

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
    const { uploadFiles, onUploadChange } = useChatInput({
      isImageMime: () => false,
    });

    onUploadChange(uploadItem, [uploadItem, file]);

    expect(uploadFiles.value).toHaveLength(1);
    expect(uploadFiles.value[0].name).toBe("dupe.txt");
  });

  it("keeps Element Plus upload items from upload change and serializes non-empty base64", async () => {
    const file = new File(["world"], "world.txt", { type: "text/plain" });
    const uploadItem = { name: "world.txt", raw: file, size: file.size };
    const { uploadFiles, onUploadChange, serializeAttachments } = useChatInput({
      isImageMime: () => false,
    });

    onUploadChange(uploadItem, [uploadItem]);

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
    const { serializeAttachments } = useChatInput({ isImageMime: () => false });

    const attachments = await serializeAttachments([{ ...file, name: file.name, mimeType: file.type, raw: file }]);
    const expectedBase64 = String(await readAsDataUrl(file)).split(",")[1];

    expect(attachments[0].contentBase64).toBe(expectedBase64);
    expect(attachments[0].contentBase64).not.toBe("");
  });
});
