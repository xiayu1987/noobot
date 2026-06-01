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

function resolveBaseName(filePath = "") {
  const normalized = String(filePath || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/");
  return String(parts[parts.length - 1] || "").trim();
}

function trimPathToken(token = "") {
  return String(token || "")
    .trim()
    .replace(/^[`"'“”‘’<>()\[\]{}（）【】《》]+/, "")
    .replace(/[`"'“”‘’<>()\[\]{}（）【】《》.,;:!?，。！？；：]+$/, "")
    .trim();
}

function isLikelyPathToken(token = "") {
  const normalized = String(token || "").trim();
  if (!normalized) return false;
  if (normalized.includes("://")) return false;
  if (normalized.startsWith("#")) return false;
  if (!normalized.includes("/")) return false;
  if (normalized.endsWith("/")) return false;
  return true;
}

function extractCandidatePathsFromText(content = "") {
  const text = String(content || "");
  if (!text) return [];
  const pathMatchRegex =
    /(?:^|[\s`"'“”‘’<>()\[\]{}（）【】《》.,;:!?，。！？；：])([./~]?[^\s`"'“”‘’<>()\[\]{}（）【】《》,;:!?，。！？；：]+\/[^\s`"'“”‘’<>()\[\]{}（）【】《》,;:!?，。！？；：]+)(?=$|[\s`"'“”‘’<>()\[\]{}（）【】《》.,;:!?，。！？；：])/g;
  const out = [];
  let match = null;
  while ((match = pathMatchRegex.exec(text))) {
    const token = trimPathToken(match?.[1] || "");
    if (!isLikelyPathToken(token)) continue;
    out.push(token);
  }
  return out;
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

function sanitizeWorkspaceRelativePath(pathValue = "") {
  const normalized = String(pathValue || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!normalized) return "";
  if (normalized.startsWith("../")) return "";
  if (normalized.includes("/../")) return "";
  if (normalized.endsWith("/..")) return "";
  return normalized;
}

function trimPathByFileExtension(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const slashIndex = normalized.lastIndexOf("/");
  const prefix = slashIndex >= 0 ? normalized.slice(0, slashIndex + 1) : "";
  const baseName = slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
  const matched = baseName.match(/^(.+?\.[a-zA-Z0-9]{1,16}).*$/);
  if (!matched?.[1]) return normalized;
  return `${prefix}${matched[1]}`;
}

function isLikelyFilePath(pathValue = "") {
  const baseName = resolveBaseName(pathValue);
  if (!baseName || baseName === "." || baseName === "..") return false;
  if (baseName.startsWith(".") && baseName.length > 1) return true; // .env / .gitignore
  const dotIndex = baseName.lastIndexOf(".");
  if (dotIndex <= 0) return false; // no extension or hidden-only token
  if (dotIndex === baseName.length - 1) return false;
  return true;
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
    if (!normalizedPath) return "";
    if (normalizedUserId) {
      const marker = `/workspace/${normalizedUserId}/`;
      const idx = normalizedPath.indexOf(marker);
      if (idx >= 0) {
        return sanitizeWorkspaceRelativePath(normalizedPath.slice(idx + marker.length));
      }
    }
    const genericWorkspaceMarker = "/workspace/";
    const genericMarkerIndex = normalizedPath.indexOf(genericWorkspaceMarker);
    if (genericMarkerIndex < 0) return "";
    return sanitizeWorkspaceRelativePath(
      normalizedPath.slice(genericMarkerIndex + genericWorkspaceMarker.length),
    );
  }

  function normalizeRecognizedFilePath(pathToken = "") {
    const normalizedUserId = String(getUserId() || "").trim();
    const normalizedPath = trimPathByFileExtension(pathToken);
    if (!normalizedPath) return null;
    const marker = normalizedUserId ? `/workspace/${normalizedUserId}/` : "";
    const markerIndex = marker ? normalizedPath.indexOf(marker) : -1;
    if (markerIndex >= 0) {
      const relativePath = sanitizeWorkspaceRelativePath(
        normalizedPath.slice(markerIndex + marker.length),
      );
      if (!relativePath || !isLikelyFilePath(relativePath)) return null;
      return {
        resolvedPath: normalizedPath,
        relativePath,
        fileName: resolveBaseName(relativePath),
      };
    }
    const genericWorkspaceMarker = "/workspace/";
    const genericMarkerIndex = normalizedPath.indexOf(genericWorkspaceMarker);
    if (genericMarkerIndex >= 0) {
      const relativePath = sanitizeWorkspaceRelativePath(
        normalizedPath.slice(genericMarkerIndex + genericWorkspaceMarker.length),
      );
      if (!relativePath || !isLikelyFilePath(relativePath)) return null;
      return {
        resolvedPath: normalizedPath,
        relativePath,
        fileName: resolveBaseName(relativePath),
      };
    }
    const workspacePrefix = normalizedUserId ? `workspace/${normalizedUserId}/` : "";
    if (workspacePrefix && normalizedPath.startsWith(workspacePrefix)) {
      const relativePath = sanitizeWorkspaceRelativePath(
        normalizedPath.slice(workspacePrefix.length),
      );
      if (!relativePath || !isLikelyFilePath(relativePath)) return null;
      return {
        resolvedPath: normalizedPath,
        relativePath,
        fileName: resolveBaseName(relativePath),
      };
    }
    const genericWorkspacePrefix = "workspace/";
    if (normalizedPath.startsWith(genericWorkspacePrefix)) {
      const relativePath = sanitizeWorkspaceRelativePath(
        normalizedPath.slice(genericWorkspacePrefix.length),
      );
      if (!relativePath || !isLikelyFilePath(relativePath)) return null;
      return {
        resolvedPath: normalizedPath,
        relativePath,
        fileName: resolveBaseName(relativePath),
      };
    }
    return null;
  }

  function toWrittenFileKey(fileItem = {}) {
    return String(
      fileItem?.relativePath ||
        fileItem?.resolvedPath ||
        fileItem?.fileName ||
        "",
    )
      .trim()
      .replaceAll("\\", "/");
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
      const fileItem = {
        toolName,
        resolvedPath,
        fileName,
        relativePath: resolveRelativeWorkspacePath(resolvedPath),
        sourceType: "tool",
        recognized: false,
      };
      const fileKey = toWrittenFileKey(fileItem);
      if (fileKey && seen.has(fileKey)) continue;
      if (fileKey) seen.add(fileKey);
      out.push(fileItem);
    }

    if (String(messageItem?.role || "").trim() === "assistant") {
      const recognizedPathTokens = extractCandidatePathsFromText(messageItem?.content || "");
      for (const pathToken of recognizedPathTokens) {
        const normalizedFileItem = normalizeRecognizedFilePath(pathToken);
        if (!normalizedFileItem?.fileName) continue;
        const fileItem = {
          toolName: "write_file",
          ...normalizedFileItem,
          sourceType: "recognized",
          recognized: true,
        };
        const fileKey = toWrittenFileKey(fileItem);
        if (fileKey && seen.has(fileKey)) continue;
        if (fileKey) seen.add(fileKey);
        out.push(fileItem);
      }
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
