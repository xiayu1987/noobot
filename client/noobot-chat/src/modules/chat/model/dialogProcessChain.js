/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { getMessageDialogProcessId, getMessageParentDialogProcessId } from "./messageIdentity.js";
import { mergeAttachmentsByIdentity } from "@noobot/attachment-protocol";
import { text } from "@noobot/shared/value";

export function mergeAttachments(existing = [], incoming = []) {
  const existingList = Array.isArray(existing) ? existing : [];
  const incomingList = Array.isArray(incoming) ? incoming : [];
  return mergeAttachmentsByIdentity(existingList, incomingList, {
    onConflict: (_current, authoritativeIncoming) => authoritativeIncoming,
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
  let currentDialogProcessId = text(startDialogProcessId);
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
    currentDialogProcessId = text(parentByDialogProcessId.get(currentDialogProcessId));
  }
  return "";
}
