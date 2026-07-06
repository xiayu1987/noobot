/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storeToRefs } from "pinia";
import { useChatStore } from "../../shared/stores/useChatStore";
import { resolveRawAttachmentFile, serializeAttachments } from "./chatEngine/attachmentSerialization";

export function useChatInput({ isImageMime, clearUploadSelection = () => {} }) {
  const chatStore = useChatStore();
  const { input, uploadFiles } = storeToRefs(chatStore);

  function createUploadEntry(rawFile) {
    const mimeType = rawFile.type || "application/octet-stream";
    return {
      raw: rawFile,
      name: rawFile.name,
      mimeType,
      size: rawFile.size || 0,
      previewUrl: isImageMime(mimeType) ? URL.createObjectURL(rawFile) : "",
    };
  }

  function getUploadEntryKey(fileItem = {}) {
    const rawFile = resolveRawAttachmentFile(fileItem) || fileItem;
    return [
      String(rawFile?.name || fileItem?.name || "").trim(),
      String(rawFile?.size || fileItem?.size || 0),
      String(rawFile?.lastModified || fileItem?.lastModified || 0),
      String(rawFile?.type || fileItem?.mimeType || "").trim(),
    ].join("|");
  }

  function dedupeUploadEntries(files = []) {
    const out = [];
    const seen = new Set();
    for (const fileItem of Array.isArray(files) ? files : []) {
      const key = getUploadEntryKey(fileItem);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      out.push(fileItem);
    }
    return out;
  }

  function revokePreviewUrls(files = []) {
    for (const uploadFile of Array.isArray(files) ? files : []) {
      if (uploadFile.previewUrl) URL.revokeObjectURL(uploadFile.previewUrl);
    }
  }

  function onUploadChange(file, fileList) {
    revokePreviewUrls(uploadFiles.value);
    const nextFileList = Array.isArray(fileList) ? fileList : [file].filter(Boolean);
    uploadFiles.value = dedupeUploadEntries(nextFileList)
      .map((fileItem) => resolveRawAttachmentFile(fileItem))
      .filter(Boolean)
      .map((rawFile) => createUploadEntry(rawFile));
  }

  function appendUploads(rawFiles = []) {
    const nextFiles = (Array.isArray(rawFiles) ? rawFiles : [])
      .filter(Boolean)
      .map((rawFile) => createUploadEntry(rawFile));
    if (!nextFiles.length) return;
    uploadFiles.value = dedupeUploadEntries([...uploadFiles.value, ...nextFiles]);
  }

  function clearUploads() {
    revokePreviewUrls(uploadFiles.value);
    uploadFiles.value = [];
    clearUploadSelection();
  }

  function removeUpload(uploadIndex) {
    const index = Number(uploadIndex);
    if (!Number.isInteger(index) || index < 0 || index >= uploadFiles.value.length) return;
    const nextUploadFiles = [...uploadFiles.value];
    const [removedFile] = nextUploadFiles.splice(index, 1);
    revokePreviewUrls([removedFile]);
    uploadFiles.value = nextUploadFiles;
  }

  return {
    input,
    uploadFiles,
    onUploadChange,
    appendUploads,
    clearUploads,
    removeUpload,
    serializeAttachments,
  };
}
