/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import {
  collectRelatedDialogProcessIds,
  flattenSessionMessages,
  mergeAttachmentMetas,
} from "../infra/dialogProcessChain";

function tryParseJsonContent(content = "") {
  try {
    return JSON.parse(String(content || ""));
  } catch {
    return null;
  }
}

function parseToolFileResult(content = "") {
  const parsed = tryParseJsonContent(content);
  if (!parsed) return null;
  const toolName = String(parsed?.toolName || "").trim();
  if (!["write_file"].includes(toolName)) return null;
  if (parsed?.ok === false) return null;
  if (toolName === "write_file" && String(parsed?.state || "").toUpperCase() !== "OK") {
    return null;
  }
  const resolvedPath = String(parsed?.resolvedPath || parsed?.path || "").trim();
  const fileName = String(parsed?.fileName || "").trim();
  if (!resolvedPath || !fileName) return null;
  return { toolName, resolvedPath, fileName };
}

function getMessageAttachmentMetas(messageItem = {}) {
  if (Array.isArray(messageItem?.attachmentMetas)) return messageItem.attachmentMetas;
  if (Array.isArray(messageItem?.attachments)) return messageItem.attachments;
  return [];
}

function isHarnessPluginInjectedMessage(messageItem = {}) {
  return (
    messageItem?.injectedMessage === true &&
    String(messageItem?.injectedBy || "").trim() === "harness-plugin"
  );
}

function toAttachmentKey(attachmentItem = {}) {
  return String(
    attachmentItem?.attachmentId ||
      `${attachmentItem?.name || ""}|${attachmentItem?.size || 0}`,
  ).trim();
}

export function useMessageFiles({
  getMessageItem = () => ({}),
  getAllMessages = () => [],
  getSessionDocs = () => [],
  getUserId = () => "",
} = {}) {
  function resolveRelativeWorkspacePath(absolutePath = "") {
    const normalizedUserId = String(getUserId() || "").trim();
    const normalizedPath = String(absolutePath || "").trim();
    if (!normalizedUserId || !normalizedPath) return "";
    const marker = `/workspace/${normalizedUserId}/`;
    const idx = normalizedPath.indexOf(marker);
    if (idx < 0) return "";
    return normalizedPath.slice(idx + marker.length);
  }

  const writtenFiles = computed(() => {
    const messageItem = getMessageItem() || {};
    const dialogProcessId = String(messageItem?.dialogProcessId || "").trim();
    if (!dialogProcessId) return [];
    const out = [];
    const seen = new Set();
    const candidateMessages = [
      ...(Array.isArray(getAllMessages()) ? getAllMessages() : []),
      ...flattenSessionMessages(getSessionDocs()),
    ];
    const relatedDialogIds = collectRelatedDialogProcessIds(
      candidateMessages,
      dialogProcessId,
    );

    for (const sessionMessage of candidateMessages) {
      if (String(sessionMessage?.role || "") !== "tool") continue;
      const currentDialogId = String(sessionMessage?.dialogProcessId || "").trim();
      const parentId = String(sessionMessage?.parentDialogProcessId || "").trim();
      if (!relatedDialogIds.has(currentDialogId) && !relatedDialogIds.has(parentId)) {
        continue;
      }
      const parsed = parseToolFileResult(sessionMessage?.content || "");
      if (!parsed) continue;
      const { resolvedPath, fileName, toolName } = parsed;
      if (seen.has(resolvedPath)) continue;
      seen.add(resolvedPath);
      const relativePath = resolveRelativeWorkspacePath(resolvedPath);
      out.push({ toolName, resolvedPath, fileName, relativePath });
    }
    return out;
  });

  const displayedAttachmentMetas = computed(() => {
    const messageItem = getMessageItem() || {};
    const baseAttachmentMetas = getMessageAttachmentMetas(messageItem);
    if (String(messageItem?.role || "").trim() !== "assistant") {
      return baseAttachmentMetas;
    }
    const rootDialogProcessId = String(messageItem?.dialogProcessId || "").trim();
    if (!rootDialogProcessId) return baseAttachmentMetas;

    const candidateMessages = [
      ...(Array.isArray(getAllMessages()) ? getAllMessages() : []),
      ...flattenSessionMessages(getSessionDocs()),
    ];
    const relatedDialogProcessIdSet = collectRelatedDialogProcessIds(
      candidateMessages,
      rootDialogProcessId,
    );
    let mainFlowAttachmentMetas = [...baseAttachmentMetas];
    let pluginAttachmentMetas = [];
    for (const sessionMessage of candidateMessages) {
      const messageRole = String(sessionMessage?.role || "").trim();
      const messageDialogProcessId = String(sessionMessage?.dialogProcessId || "").trim();
      const messageParentDialogProcessId = String(
        sessionMessage?.parentDialogProcessId || "",
      ).trim();
      if (
        !relatedDialogProcessIdSet.has(messageDialogProcessId) &&
        !relatedDialogProcessIdSet.has(messageParentDialogProcessId)
      ) {
        continue;
      }
      const currentAttachmentMetas = getMessageAttachmentMetas(sessionMessage);
      if (!currentAttachmentMetas.length) continue;
      if (
        messageRole === "user" &&
        isHarnessPluginInjectedMessage(sessionMessage)
      ) {
        pluginAttachmentMetas = mergeAttachmentMetas(
          pluginAttachmentMetas,
          currentAttachmentMetas,
        );
        continue;
      }
      if (!["assistant", "tool"].includes(messageRole)) continue;
      mainFlowAttachmentMetas = mergeAttachmentMetas(
        mainFlowAttachmentMetas,
        currentAttachmentMetas,
      );
    }
    const mergedWithOwnerType = [
      ...mainFlowAttachmentMetas.map((attachmentItem) => ({
        ...attachmentItem,
        attachmentOwnerType: "agent",
      })),
      ...pluginAttachmentMetas.map((attachmentItem) => ({
        ...attachmentItem,
        attachmentOwnerType: "plugin",
      })),
    ];
    const dedupedWithOwnerType = [];
    const seenAttachmentKeySet = new Map();
    for (const attachmentItem of mergedWithOwnerType) {
      const attachmentKey = toAttachmentKey(attachmentItem);
      if (!attachmentKey) {
        dedupedWithOwnerType.push(attachmentItem);
        continue;
      }
      const existingIndex = seenAttachmentKeySet.get(attachmentKey);
      if (existingIndex === undefined) {
        seenAttachmentKeySet.set(attachmentKey, dedupedWithOwnerType.length);
        dedupedWithOwnerType.push(attachmentItem);
        continue;
      }
      if (attachmentItem?.attachmentOwnerType === "plugin") {
        dedupedWithOwnerType[existingIndex] = attachmentItem;
      }
    }
    return dedupedWithOwnerType;
  });

  return {
    writtenFiles,
    displayedAttachmentMetas,
  };
}
