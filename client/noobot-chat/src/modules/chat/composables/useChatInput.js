/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createSecureId } from "@noobot/shared/secure-identity";
import { storeToRefs } from "pinia";
import { useChatStore } from "../stores/useChatStore.js";
import {
  resolveRawAttachmentFile,
  serializeAttachments,
} from "../runtime/engine/attachmentSerialization.js";
import { text } from "@noobot/shared/value";

export function useChatInput({ isImageMime, clearUploadSelection = () => {} }) {
  const chatStore = useChatStore();
  const { input, uploadFiles } = storeToRefs(chatStore);

  function createDraftAttachmentId() {
    return createSecureId("draft-attachment");
  }

  function createUploadEntry(rawFile) {
    const mimeType = rawFile.type || "application/octet-stream";
    return {
      draftAttachmentId: createDraftAttachmentId(),
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
      text(rawFile?.name || fileItem?.name),
      String(rawFile?.size || fileItem?.size || 0),
      String(rawFile?.lastModified || fileItem?.lastModified || 0),
      text(rawFile?.type || fileItem?.mimeType),
    ].join("|");
  }

  function revokePreviewUrls(files = []) {
    for (const uploadFile of Array.isArray(files) ? files : []) {
      if (uploadFile.previewUrl) URL.revokeObjectURL(uploadFile.previewUrl);
    }
  }

  function appendUploads(rawFiles = []) {
    const seen = new Set(uploadFiles.value.map((fileItem) => getUploadEntryKey(fileItem)));
    const nextFiles = [];
    for (const fileItem of Array.isArray(rawFiles) ? rawFiles : []) {
      const rawFile = resolveRawAttachmentFile(fileItem);
      if (!rawFile) continue;
      const key = getUploadEntryKey(rawFile);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      nextFiles.push(createUploadEntry(rawFile));
    }
    if (!nextFiles.length) return;
    uploadFiles.value = [...uploadFiles.value, ...nextFiles];
  }

  function clearUploads() {
    revokePreviewUrls(uploadFiles.value);
    uploadFiles.value = [];
    clearUploadSelection();
  }

  function removeUpload(draftAttachmentId = "") {
    const normalizedId = text(draftAttachmentId);
    if (!normalizedId) return;
    const removedFile = uploadFiles.value.find(
      (fileItem) => fileItem?.draftAttachmentId === normalizedId,
    );
    if (!removedFile) return;
    revokePreviewUrls([removedFile]);
    uploadFiles.value = uploadFiles.value.filter(
      (fileItem) => fileItem?.draftAttachmentId !== normalizedId,
    );
  }

  return {
    input,
    uploadFiles,
    appendUploads,
    clearUploads,
    removeUpload,
    serializeAttachments,
  };
}
