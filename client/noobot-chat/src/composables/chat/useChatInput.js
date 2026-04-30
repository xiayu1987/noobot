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

  function onUploadChange(file, fileList) {
    uploadFiles.value = fileList
      .map((fileItem) => fileItem.raw)
      .filter(Boolean)
      .map((raw) => ({
        raw,
        name: raw.name,
        mimeType: raw.type || "application/octet-stream",
        size: raw.size || 0,
        previewUrl: isImageMime(raw.type || "") ? URL.createObjectURL(raw) : "",
      }));
  }

  function clearUploads() {
    for (const uploadFile of uploadFiles.value) {
      if (uploadFile.previewUrl) URL.revokeObjectURL(uploadFile.previewUrl);
    }
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
    clearUploads,
    serializeAttachments,
  };
}
