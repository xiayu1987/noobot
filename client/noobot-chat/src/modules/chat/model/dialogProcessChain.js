/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
} from "./messageIdentity.js";
import {
  attachmentIdentityKey,
  projectAttachmentIdentity,
} from "@noobot/attachment-protocol";

function canonicalAttachmentKey(attachmentItem = {}) {
  return attachmentIdentityKey(projectAttachmentIdentity(attachmentItem));
}

export function mergeAttachmentMetaFields(existingItem = {}, incomingItem = {}) {
  const existing = existingItem && typeof existingItem === "object" ? existingItem : {};
  const incoming = incomingItem && typeof incomingItem === "object" ? incomingItem : {};
  const merged = { ...existing, ...incoming };

  for (const field of [
    "attachmentId",
    "url",
    "previewUrl",
    "thumbnailUrl",
    "contentUrl",
    "sourceUrl",
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
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  existingList.forEach(canonicalAttachmentKey);
  if (!incomingList.length) return existingList;
  const merged = [...existingList];
  const indexByKey = new Map();
  existingList.forEach((attachmentItem, index) => {
    const attachmentKey = canonicalAttachmentKey(attachmentItem);
    if (!indexByKey.has(attachmentKey)) indexByKey.set(attachmentKey, index);
  });
  for (const attachmentItem of incomingList) {
    const attachmentKey = canonicalAttachmentKey(attachmentItem);
    if (indexByKey.has(attachmentKey)) {
      const existingIndex = indexByKey.get(attachmentKey);
      const existingItem = merged[existingIndex] || {};
      merged[existingIndex] = mergeAttachmentMetaFields(existingItem, attachmentItem);
      continue;
    }
    merged.push(attachmentItem);
    indexByKey.set(attachmentKey, merged.length - 1);
  }
  return merged;
}

export function mergeAttachmentSnapshot(existing = [], snapshot = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const snapshotList = Array.isArray(snapshot) ? snapshot : [];
  const existingByKey = new Map();
  for (const attachmentItem of existingList) {
    const key = canonicalAttachmentKey(attachmentItem);
    if (!existingByKey.has(key)) existingByKey.set(key, attachmentItem);
  }
  return snapshotList.map((snapshotItem) => {
    const existingItem = existingByKey.get(canonicalAttachmentKey(snapshotItem));
    return existingItem
      ? mergeAttachmentMetaFields(existingItem, snapshotItem)
      : snapshotItem;
  });
}

export function flattenSessionMessages(sessionDocs = []) {
  return (Array.isArray(sessionDocs) ? sessionDocs : []).flatMap((sessionDoc) =>
    Array.isArray(sessionDoc?.rawMessages) ? sessionDoc.rawMessages : [],
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
