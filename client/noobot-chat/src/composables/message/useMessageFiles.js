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
import {
  getMessageDialogProcessId,
  getMessageParentDialogProcessId,
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
  getMessageTurnId,
  isSameMessageRound,
  normalizeTurnMeta,
  shouldCollectAttachmentMetasFromMessage,
} from "../infra/messageIdentity";
import { getMessageTransferAttachmentMetas } from "../infra/transferEnvelopes";

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
  const base = Array.isArray(messageItem?.attachmentMetas)
    ? messageItem.attachmentMetas
    : [];
  const transferMetas = getMessageTransferAttachmentMetas(messageItem);
  return transferMetas.length ? mergeAttachmentMetas(transferMetas, base) : base;
}

function trim(value = "") {
  return String(value || "").trim();
}

function getMessageTurnIdentity(messageItem = {}) {
  return {
    sessionId: getMessageSessionId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
    turnId: getMessageTurnId(messageItem),
    dialogProcessId: getMessageDialogProcessId(messageItem),
  };
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getAttachmentOwnership(attachmentItem = {}) {
  const attachmentOwner = isPlainObject(attachmentItem?.attachment?.owner)
    ? attachmentItem.attachment.owner
    : null;
  const owner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : null;
  const turnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : {};
  const ownershipSource = attachmentOwner || owner || turnScope;
  const normalized = normalizeTurnMeta(ownershipSource);
  return {
    ...normalized,
    sessionId: trim(
      normalized.sessionId ||
        ownershipSource?.sessionId ||
        ownershipSource?.session_id ||
        turnScope?.sessionId ||
        turnScope?.session_id ||
        attachmentItem?.sessionId ||
        attachmentItem?.session_id,
    ),
  };
}

function hasExplicitAttachmentOwnership(attachmentItem = {}) {
  const ownership = getAttachmentOwnership(attachmentItem);
  return Boolean(ownership.turnScopeId || ownership.turnId || ownership.dialogProcessId);
}

function isAttachmentOwnedByMessage(attachmentItem = {}, messageItem = {}) {
  if (!hasExplicitAttachmentOwnership(attachmentItem)) return true;
  const attachmentOwnership = getAttachmentOwnership(attachmentItem);
  const messageIdentity = getMessageTurnIdentity(messageItem);

  if (attachmentOwnership.turnScopeId) {
    const sameTurnScope = Boolean(
      messageIdentity.turnScopeId &&
        attachmentOwnership.turnScopeId === messageIdentity.turnScopeId,
    );
    if (!sameTurnScope) return false;
    if (attachmentOwnership.sessionId && messageIdentity.sessionId) {
      return attachmentOwnership.sessionId === messageIdentity.sessionId;
    }
    return true;
  }
  if (attachmentOwnership.turnId) {
    return Boolean(
      messageIdentity.turnId && attachmentOwnership.turnId === messageIdentity.turnId,
    );
  }
  if (attachmentOwnership.dialogProcessId) {
    return Boolean(
      messageIdentity.dialogProcessId &&
        attachmentOwnership.dialogProcessId === messageIdentity.dialogProcessId,
    );
  }
  return true;
}

function filterAttachmentMetasForMessage(attachmentMetas = [], messageItem = {}) {
  return (Array.isArray(attachmentMetas) ? attachmentMetas : []).filter((attachmentItem) =>
    isAttachmentOwnedByMessage(attachmentItem, messageItem),
  );
}

function isFreshPendingAssistant(messageItem = {}) {
  return (
    getMessageRole(messageItem) === "assistant" &&
    messageItem?.pending === true &&
    messageItem?.hasFirstStreamEvent !== true
  );
}

function isHarnessPluginInjectedMessage(messageItem = {}) {
  return (
    messageItem?.injectedMessage === true &&
    String(messageItem?.injectedBy || "").trim() === "harness-plugin"
  );
}

function isHarnessPluginAttachmentMeta(attachmentItem = {}) {
  const ownerType = String(attachmentItem?.attachmentOwnerType || "").trim();
  if (ownerType === "plugin") return true;
  const owner = String(attachmentItem?.attachmentOwner || "").trim();
  if (owner === "harness-plugin") return true;
  return false;
}

function splitAttachmentMetasByOwner(attachmentMetas = []) {
  const plugin = [];
  const agent = [];
  for (const attachmentItem of Array.isArray(attachmentMetas) ? attachmentMetas : []) {
    if (isHarnessPluginAttachmentMeta(attachmentItem)) plugin.push(attachmentItem);
    else agent.push(attachmentItem);
  }
  return { agent, plugin };
}

function normalizeMessageText(value = "") {
  return String(value || "").trim();
}

function findMessageIndexInLinearTurn(messages = [], targetMessage = {}) {
  const messageList = Array.isArray(messages) ? messages : [];
  const objectIndex = messageList.findIndex((messageItem) => messageItem === targetMessage);
  if (objectIndex >= 0) return objectIndex;

  const targetRole = getMessageRole(targetMessage);
  const targetDialogProcessId = getMessageDialogProcessId(targetMessage);
  const targetContent = normalizeMessageText(targetMessage?.content);

  const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
  const targetSessionId = getMessageSessionId(targetMessage);
  if (targetTurnScopeId) {
    const turnScopeIndex = messageList.findIndex((messageItem) => {
      if (getMessageRole(messageItem) !== targetRole) return false;
      if (getMessageTurnScopeId(messageItem) !== targetTurnScopeId) return false;
      const candidateSessionId = getMessageSessionId(messageItem);
      return !targetSessionId || !candidateSessionId || targetSessionId === candidateSessionId;
    });
    if (turnScopeIndex >= 0) return turnScopeIndex;
  }
  if (targetDialogProcessId) {
    const dialogIndex = messageList.findIndex(
      (messageItem) =>
        getMessageRole(messageItem) === targetRole &&
        getMessageDialogProcessId(messageItem) === targetDialogProcessId,
    );
    if (dialogIndex >= 0) return dialogIndex;
  }
  if (targetContent) {
    const contentIndex = messageList.findIndex(
      (messageItem) =>
        getMessageRole(messageItem) === targetRole &&
        normalizeMessageText(messageItem?.content) === targetContent,
    );
    if (contentIndex >= 0) return contentIndex;
  }
  return -1;
}

function getLinearTurnBounds(messages = [], targetMessage = {}) {
  const messageList = Array.isArray(messages) ? messages : [];
  const targetIndex = findMessageIndexInLinearTurn(messageList, targetMessage);
  if (targetIndex < 0) return null;
  let previousUserIndex = -1;
  for (let index = targetIndex; index >= 0; index -= 1) {
    if (getMessageRole(messageList[index]) === "user") {
      previousUserIndex = index;
      break;
    }
  }
  let nextUserIndex = messageList.length;
  for (let index = targetIndex + 1; index < messageList.length; index += 1) {
    if (getMessageRole(messageList[index]) === "user") {
      nextUserIndex = index;
      break;
    }
  }
  return { targetIndex, previousUserIndex, nextUserIndex };
}

function isMessageInsideLinearTurn(messages = [], bounds = null, candidateMessage = {}) {
  if (!bounds) return true;
  const messageList = Array.isArray(messages) ? messages : [];
  const candidateIndex = messageList.findIndex((messageItem) => messageItem === candidateMessage);
  if (candidateIndex < 0) return true;
  return candidateIndex > bounds.previousUserIndex && candidateIndex < bounds.nextUserIndex;
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

function stripWorkspaceLikePrefix(pathValue = "", userId = "") {
  const normalizedPath = String(pathValue || "").trim();
  const normalizedUserId = String(userId || "").trim();
  const prefixedCandidates = normalizedUserId
    ? [
        `workspace/${normalizedUserId}/`,
        `workplace/${normalizedUserId}/`,
      ]
    : [];
  for (const prefix of prefixedCandidates) {
    if (normalizedPath.startsWith(prefix)) {
      return normalizedPath.slice(prefix.length);
    }
  }
  for (const prefix of ["workspace/", "workplace/"]) {
    if (normalizedPath.startsWith(prefix)) {
      return normalizedPath.slice(prefix.length);
    }
  }
  return "";
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
    const workspaceLikeRelativePath = sanitizeWorkspaceRelativePath(
      stripWorkspaceLikePrefix(normalizedPath, normalizedUserId),
    );
    if (workspaceLikeRelativePath) {
      const relativePath = workspaceLikeRelativePath;
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
    if (isFreshPendingAssistant(messageItem)) return [];
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const dialogProcessId = getMessageDialogProcessId(messageItem);
    if (!turnScopeId && !dialogProcessId) return [];
    const out = [];
    const seen = new Set();
    for (const logItem of Array.isArray(messageItem?.completedToolLogs) ? messageItem.completedToolLogs : []) {
      for (const fileItem of Array.isArray(logItem?.writtenFiles) ? logItem.writtenFiles : []) {
        if (!fileItem?.fileName && !fileItem?.resolvedPath) continue;
        const normalizedFileItem = {
          toolName: fileItem?.toolName || "write_file",
          resolvedPath: fileItem?.resolvedPath || "",
          fileName: fileItem?.fileName || resolveBaseName(fileItem?.resolvedPath || ""),
          relativePath: fileItem?.relativePath || resolveRelativeWorkspacePath(fileItem?.resolvedPath || ""),
          sourceType: fileItem?.sourceType || "tool",
          recognized: fileItem?.recognized === true,
        };
        const fileKey = toWrittenFileKey(normalizedFileItem);
        if (fileKey && seen.has(fileKey)) continue;
        if (fileKey) seen.add(fileKey);
        out.push(normalizedFileItem);
      }
    }
    const candidateMessages = [
      ...(Array.isArray(getAllMessages()) ? getAllMessages() : []),
      ...flattenSessionMessages(getSessionDocs()),
    ];
    const relatedDialogIds = turnScopeId
      ? new Set()
      : collectRelatedDialogProcessIds(
          candidateMessages,
          dialogProcessId,
        );

    for (const sessionMessage of candidateMessages) {
      if (getMessageRole(sessionMessage) !== "tool") continue;
      if (!isSameMessageRound(messageItem, sessionMessage)) continue;
      if (!turnScopeId) {
        const currentDialogId = getMessageDialogProcessId(sessionMessage);
        const parentId = getMessageParentDialogProcessId(sessionMessage);
        if (!relatedDialogIds.has(currentDialogId) && !relatedDialogIds.has(parentId)) {
          continue;
        }
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

    if (getMessageRole(messageItem) === "assistant") {
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
    const toolLogAttachmentMetas = [];
    for (const logItem of Array.isArray(messageItem?.completedToolLogs) ? messageItem.completedToolLogs : []) {
      toolLogAttachmentMetas.push(
        ...(Array.isArray(logItem?.attachmentMetas) ? logItem.attachmentMetas : []),
      );
    }
    const mergedBaseAttachmentMetas = toolLogAttachmentMetas.length
      ? mergeAttachmentMetas(baseAttachmentMetas, toolLogAttachmentMetas)
      : baseAttachmentMetas;
    if (getMessageRole(messageItem) !== "assistant") {
      return mergedBaseAttachmentMetas;
    }
    if (isFreshPendingAssistant(messageItem)) {
      return mergedBaseAttachmentMetas;
    }
    const rootTurnScopeId = getMessageTurnScopeId(messageItem);
    const rootDialogProcessId = getMessageDialogProcessId(messageItem);
    if (!rootTurnScopeId && !rootDialogProcessId) return baseAttachmentMetas;

    const allMessages = Array.isArray(getAllMessages()) ? getAllMessages() : [];
    const sessionDocMessages = flattenSessionMessages(getSessionDocs());
    const candidateMessages = [
      ...allMessages,
      ...sessionDocMessages,
    ];
    const allMessagesTurnBounds = getLinearTurnBounds(allMessages, messageItem);
    const sessionDocTurnBounds = getLinearTurnBounds(sessionDocMessages, messageItem);
    const relatedDialogProcessIdSet = rootTurnScopeId
      ? new Set()
      : collectRelatedDialogProcessIds(
          candidateMessages,
          rootDialogProcessId,
        );
    const baseSplit = splitAttachmentMetasByOwner(mergedBaseAttachmentMetas);
    let mainFlowAttachmentMetas = [...baseSplit.agent];
    let pluginAttachmentMetas = [...baseSplit.plugin];
    for (const sessionMessage of candidateMessages) {
      const messageRole = getMessageRole(sessionMessage);
      const messageDialogProcessId = getMessageDialogProcessId(sessionMessage);
      const messageParentDialogProcessId = getMessageParentDialogProcessId(sessionMessage);
      // During a live turn, rawMessages can still contain tool attachment events
      // from previous turns while the current assistant message is being patched.
      // Keep attachment collection inside the target user->assistant turn window
      // whenever we can locate both messages in the same linear message list.
      if (
        !isMessageInsideLinearTurn(allMessages, allMessagesTurnBounds, sessionMessage) ||
        !isMessageInsideLinearTurn(sessionDocMessages, sessionDocTurnBounds, sessionMessage)
      ) {
        continue;
      }
      if (!isSameMessageRound(messageItem, sessionMessage)) {
        continue;
      }
      if (!rootTurnScopeId) {
        if (
          !relatedDialogProcessIdSet.has(messageDialogProcessId) &&
          !relatedDialogProcessIdSet.has(messageParentDialogProcessId)
        ) {
          continue;
        }
      }
      if (!shouldCollectAttachmentMetasFromMessage(messageItem, sessionMessage)) {
        continue;
      }
      const currentAttachmentMetas = filterAttachmentMetasForMessage(
        getMessageAttachmentMetas(sessionMessage),
        messageItem,
      );
      if (!currentAttachmentMetas.length) continue;
      const splitCurrentAttachmentMetas = splitAttachmentMetasByOwner(currentAttachmentMetas);
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
      if (splitCurrentAttachmentMetas.plugin.length) {
        pluginAttachmentMetas = mergeAttachmentMetas(
          pluginAttachmentMetas,
          splitCurrentAttachmentMetas.plugin,
        );
      }
      if (!["assistant", "tool"].includes(messageRole)) continue;
      if (!splitCurrentAttachmentMetas.agent.length) continue;
      mainFlowAttachmentMetas = mergeAttachmentMetas(
        mainFlowAttachmentMetas,
        splitCurrentAttachmentMetas.agent,
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
