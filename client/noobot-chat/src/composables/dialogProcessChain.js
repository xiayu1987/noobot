/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export function mergeAttachmentMetas(existing = [], incoming = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  if (!incomingList.length) return existingList;
  const merged = [...existingList];
  const toKey = (attachmentItem = {}) =>
    String(
      attachmentItem?.attachmentId ||
        `${attachmentItem?.name || ""}|${attachmentItem?.size || 0}`,
    ).trim();
  const seen = new Set(
    existingList.map((attachmentItem) => toKey(attachmentItem)).filter(Boolean),
  );
  for (const attachmentItem of incomingList) {
    const attachmentKey = toKey(attachmentItem);
    if (attachmentKey && seen.has(attachmentKey)) continue;
    merged.push(attachmentItem);
    if (attachmentKey) seen.add(attachmentKey);
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
    const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
    if (!dialogProcessId) continue;
    const parentDialogProcessId = String(
      messageItem?.parentDialogProcessId || "",
    ).trim();
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
      const parentDialogProcessId = String(
        sessionMessage?.parentDialogProcessId || "",
      ).trim();
      const childDialogProcessId = String(
        sessionMessage?.dialogProcessId || "",
      ).trim();
      if (!parentDialogProcessId || !childDialogProcessId) continue;
      if (!relatedDialogProcessIdSet.has(parentDialogProcessId)) continue;
      if (relatedDialogProcessIdSet.has(childDialogProcessId)) continue;
      relatedDialogProcessIdSet.add(childDialogProcessId);
      changed = true;
    }
  }
  return relatedDialogProcessIdSet;
}
