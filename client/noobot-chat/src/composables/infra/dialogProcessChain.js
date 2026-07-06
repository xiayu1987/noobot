/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
} from "./messageIdentity";

export function mergeAttachmentMetaFields(existingItem = {}, incomingItem = {}) {
  const existing = existingItem && typeof existingItem === "object" ? existingItem : {};
  const incoming = incomingItem && typeof incomingItem === "object" ? incomingItem : {};
  const merged = { ...existing, ...incoming };

  // Keep preview/download addressing fields from the richer side.  Some replayed
  // or plugin-owned metas only carry display fields (name/size/owner); replacing
  // the original object with those would make canPreviewAttachment true while
  // openAttachmentPreview cannot resolve a target URL.
  for (const field of [
    "attachmentId",
    "previewUrl",
    "downloadUrl",
    "parsedResultUrl",
    "parsedResultName",
    "parsedResultAttachmentId",
    "sessionId",
    "attachmentSource",
    "source",
    "mimeType",
    "name",
    "path",
    "relativePath",
    "sandboxPath",
    "transferFilePath",
    "parsedResultPath",
    "parsedResultRelativePath",
    "parsedResultSessionId",
    "parsedResultAttachmentSource",
  ]) {
    const incomingValue = incoming[field];
    const existingValue = existing[field];
    if (
      (incomingValue === undefined || incomingValue === null || String(incomingValue).trim() === "") &&
      existingValue !== undefined &&
      existingValue !== null &&
      String(existingValue).trim() !== ""
    ) {
      merged[field] = existingValue;
    }
  }
  if (existing.parsedResult && !incoming.parsedResult) merged.parsedResult = existing.parsedResult;
  if (incoming.parsedResult && existing.parsedResult) {
    merged.parsedResult = mergeAttachmentMetaFields(existing.parsedResult, incoming.parsedResult);
  }
  return merged;
}

export function mergeAttachments(existing = [], incoming = []) {
  // Frontend message attachments are a UI view over session-message attachment
  // refs.  Resend/session-detail payloads can be raw transport refs, so all local
  // write-backs go through this rich-first merge instead of replacing the message
  // attachment array and losing parsedResult/preview/download fields.
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (!incomingList.length) return existingList;
  const merged = [...existingList];
  const normalizeKeyPart = (value = "") => String(value || "").trim().toLowerCase();
  const toKeys = (attachmentItem = {}) => {
    const keys = [];
    const pushKey = (key = "") => {
      const normalized = String(key || "").trim();
      if (normalized && !keys.includes(normalized)) keys.push(normalized);
    };
    const attachmentId = normalizeKeyPart(attachmentItem?.attachmentId);
    const parsedResultAttachmentId = normalizeKeyPart(attachmentItem?.parsedResultAttachmentId);
    const name = normalizeKeyPart(attachmentItem?.name || attachmentItem?.parsedResultName);
    const mimeType = normalizeKeyPart(attachmentItem?.mimeType || attachmentItem?.type);
    const size = Number(attachmentItem?.size || 0) || 0;
    const path = normalizeKeyPart(
      attachmentItem?.path ||
        attachmentItem?.relativePath ||
        attachmentItem?.transferFilePath ||
        attachmentItem?.downloadUrl ||
        attachmentItem?.parsedResultUrl,
    );
    pushKey(attachmentId ? `id:${attachmentId}` : "");
    pushKey(parsedResultAttachmentId ? `parsed-id:${parsedResultAttachmentId}` : "");
    pushKey(path ? `path:${path}` : "");
    if (name) {
      pushKey(`name:${name}|mime:${mimeType}`);
      pushKey(`name:${name}|size:${size}`);
    }
    return keys;
  };
  const indexByKey = new Map();
  existingList.forEach((attachmentItem, index) => {
    for (const attachmentKey of toKeys(attachmentItem)) {
      if (attachmentKey && !indexByKey.has(attachmentKey)) indexByKey.set(attachmentKey, index);
    }
  });
  for (const attachmentItem of incomingList) {
    const attachmentKeys = toKeys(attachmentItem);
    const matchedKey = attachmentKeys.find((attachmentKey) => indexByKey.has(attachmentKey));
    if (matchedKey) {
      const existingIndex = indexByKey.get(matchedKey);
      const existingItem = merged[existingIndex] || {};
      merged[existingIndex] = mergeAttachmentMetaFields(existingItem, attachmentItem);
      for (const attachmentKey of toKeys(merged[existingIndex])) {
        if (attachmentKey && !indexByKey.has(attachmentKey)) indexByKey.set(attachmentKey, existingIndex);
      }
      continue;
    }
    merged.push(attachmentItem);
    for (const attachmentKey of attachmentKeys) {
      if (attachmentKey && !indexByKey.has(attachmentKey)) indexByKey.set(attachmentKey, merged.length - 1);
    }
  }
  return merged;
}

export function flattenSessionMessages(sessionDocs = []) {
  return (Array.isArray(sessionDocs) ? sessionDocs : []).flatMap((sessionDoc) =>
    Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [],
  );
}

export function buildDialogProcessParentMap(messages = []) {
  const parentByDialogProcessId = new Map();
  for (const messageItem of Array.isArray(messages) ? messages : []) {
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    if (!dialogProcessId) continue;
    const parentDialogProcessId = getMessageParentDialogProcessId(messageItem);
    if (!parentDialogProcessId) continue;
    if (!parentByDialogProcessId.has(dialogProcessId)) {
      parentByDialogProcessId.set(dialogProcessId, parentDialogProcessId);
    }
  }
  return parentByDialogProcessId;
}

export function resolveRootDialogProcessIdByChain({
  startDialogProcessId = "",
  rootDialogProcessIdSet = new Set(),
  parentByDialogProcessId = new Map(),
} = {}) {
  let currentDialogProcessId = String(startDialogProcessId || "").trim();
  if (!currentDialogProcessId) return "";
  const visited = new Set();
  while (currentDialogProcessId) {
    if (rootDialogProcessIdSet.has(currentDialogProcessId)) {
      return currentDialogProcessId;
    }
    if (visited.has(currentDialogProcessId)) {
      return "";
    }
    visited.add(currentDialogProcessId);
    currentDialogProcessId = String(
      parentByDialogProcessId.get(currentDialogProcessId) || "",
    ).trim();
  }
  return "";
}

export function collectRelatedDialogProcessIds(messages = [], rootDialogProcessId = "") {
  const normalizedRootDialogProcessId = String(rootDialogProcessId || "").trim();
  if (!normalizedRootDialogProcessId) return new Set();
  const relatedDialogProcessIdSet = new Set([normalizedRootDialogProcessId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const sessionMessage of Array.isArray(messages) ? messages : []) {
      const parentDialogProcessId = getMessageParentDialogProcessId(sessionMessage);
      const childDialogProcessId = getMessageDialogProcessId(sessionMessage);
      if (!parentDialogProcessId || !childDialogProcessId) continue;
      if (!relatedDialogProcessIdSet.has(parentDialogProcessId)) continue;
      if (relatedDialogProcessIdSet.has(childDialogProcessId)) continue;
      relatedDialogProcessIdSet.add(childDialogProcessId);
      changed = true;
    }
  }
  return relatedDialogProcessIdSet;
}
