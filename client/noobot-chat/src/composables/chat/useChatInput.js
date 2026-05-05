/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { storeToRefs } from "pinia";
import { useChatStore } from "../../shared/stores/useChatStore";

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

  function revokePreviewUrls(files = []) {
    for (const uploadFile of Array.isArray(files) ? files : []) {
      if (uploadFile.previewUrl) URL.revokeObjectURL(uploadFile.previewUrl);
    }
  }

  function onUploadChange(file, fileList) {
    revokePreviewUrls(uploadFiles.value);
    uploadFiles.value = fileList
      .map((fileItem) => fileItem.raw)
      .filter(Boolean)
      .map((rawFile) => createUploadEntry(rawFile));
  }

  function appendUploads(rawFiles = []) {
    const nextFiles = (Array.isArray(rawFiles) ? rawFiles : [])
      .filter(Boolean)
      .map((rawFile) => createUploadEntry(rawFile));
    if (!nextFiles.length) return;
    uploadFiles.value = [...uploadFiles.value, ...nextFiles];
  }

  function clearUploads() {
    revokePreviewUrls(uploadFiles.value);
    uploadFiles.value = [];
    clearUploadSelection();
  }

  async function serializeAttachments(files = []) {
    const output = [];
    for (const fileItem of Array.isArray(files) ? files : []) {
      output.push({
        name: fileItem.name,
        mimeType: fileItem.mimeType || "application/octet-stream",
        contentBase64: await toBase64(fileItem.raw),
      });
    }
    return output;
  }

  return {
    input,
    uploadFiles,
    onUploadChange,
    appendUploads,
    clearUploads,
    serializeAttachments,
  };
}
