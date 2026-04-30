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
    const baseAttachmentMetas = Array.isArray(messageItem?.attachmentMetas)
      ? messageItem.attachmentMetas
      : [];
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
    let mergedAttachmentMetas = [...baseAttachmentMetas];
    for (const sessionMessage of candidateMessages) {
      if (String(sessionMessage?.role || "").trim() !== "assistant") continue;
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
      const currentAttachmentMetas = Array.isArray(sessionMessage?.attachmentMetas)
        ? sessionMessage.attachmentMetas
        : [];
      if (!currentAttachmentMetas.length) continue;
      mergedAttachmentMetas = mergeAttachmentMetas(
        mergedAttachmentMetas,
        currentAttachmentMetas,
      );
    }
    return mergedAttachmentMetas;
  });

  return {
    writtenFiles,
    displayedAttachmentMetas,
  };
}

