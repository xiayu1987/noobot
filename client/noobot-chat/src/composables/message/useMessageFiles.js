/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { computed } from "vue";
import {
  mergeAttachments,
} from "../infra/dialogProcessChain";
import {
  getMessageRole,
  getMessageSessionId,
  getMessageTurnScopeId,
  isAssistantWithoutTurnScope,
  isSameMessageRound,
  normalizeTurnMeta,
  shouldCollectAttachmentsFromMessage,
} from "../infra/messageIdentity";
import { getMessageAttachments as resolveRenderableMessageAttachments } from "../infra/messageModel";

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

function getMessageAttachments(messageItem = {}) {
  return resolveRenderableMessageAttachments(messageItem);
}

function trim(value = "") {
  return String(value || "").trim();
}

function getMessageScopeIdentity(messageItem = {}) {
  return {
    sessionId: getMessageSessionId(messageItem),
    turnScopeId: getMessageTurnScopeId(messageItem),
  };
}

function flattenSessionMessagesWithSessionId(sessionDocs = []) {
  return (Array.isArray(sessionDocs) ? sessionDocs : []).flatMap((sessionDoc) => {
    const sessionId = getMessageSessionId(sessionDoc);
    const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
    return messages.map((messageItem) =>
      getMessageSessionId(messageItem) || !sessionId
        ? messageItem
        : { ...messageItem, sessionId },
    );
  });
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getAttachmentOwnership(attachmentItem = {}) {
  const owner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : null;
  const turnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : {};
  const ownershipSource = owner || turnScope;
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
  return Boolean(ownership.turnScopeId);
}

function isAttachmentOwnedByMessage(attachmentItem = {}, messageItem = {}) {
  if (!hasExplicitAttachmentOwnership(attachmentItem)) return true;
  const attachmentOwnership = getAttachmentOwnership(attachmentItem);
  const messageIdentity = getMessageScopeIdentity(messageItem);

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
  return true;
}

function filterAttachmentsForMessage(attachments = [], messageItem = {}) {
  return (Array.isArray(attachments) ? attachments : []).filter((attachmentItem) =>
    isAttachmentOwnedByMessage(attachmentItem, messageItem),
  );
}

function isSameExplicitTurnScope(targetMessage = {}, candidateMessage = {}) {
  const targetTurnScopeId = getMessageTurnScopeId(targetMessage);
  if (!targetTurnScopeId) return false;
  const candidateTurnScopeId = getMessageTurnScopeId(candidateMessage);
  if (candidateTurnScopeId !== targetTurnScopeId) return false;
  const targetSessionId = getMessageSessionId(targetMessage);
  const candidateSessionId = getMessageSessionId(candidateMessage);
  if (targetSessionId && candidateSessionId && targetSessionId !== candidateSessionId) {
    return false;
  }
  return true;
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
  const nestedOwner = isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : null;
  const turnScope = isPlainObject(attachmentItem?.turnScope) ? attachmentItem.turnScope : null;
  for (const ownerSource of [nestedOwner, turnScope]) {
    if (!ownerSource) continue;
    const nestedOwnerType = String(ownerSource?.type || "").trim();
    const nestedOwnerName = String(ownerSource?.id || "").trim();
    if (nestedOwnerType === "plugin") return true;
    if (nestedOwnerName === "harness-plugin") return true;
  }
  return false;
}

function splitAttachmentsByOwner(attachments = []) {
  const plugin = [];
  const agent = [];
  for (const attachmentItem of Array.isArray(attachments) ? attachments : []) {
    if (isHarnessPluginAttachmentMeta(attachmentItem)) plugin.push(attachmentItem);
    else agent.push(attachmentItem);
  }
  return { agent, plugin };
}

function withAttachmentOwners(attachments = []) {
  const split = splitAttachmentsByOwner(attachments);
  const markOwnerType = (attachmentItem = {}, type = "") => ({
    ...attachmentItem,
    owner: {
      ...(isPlainObject(attachmentItem?.owner) ? attachmentItem.owner : {}),
      type,
    },
  });
  return [
    ...split.agent.map((attachmentItem) => markOwnerType(attachmentItem, "agent")),
    ...split.plugin.map((attachmentItem) => markOwnerType(attachmentItem, "plugin")),
  ];
}

function getAttachmentOwnerType(attachmentItem = {}) {
  return String(attachmentItem?.owner?.type || "").trim();
}

function toAttachmentKey(attachmentItem = {}) {
  return String(
    attachmentItem?.attachmentId ||
      `${attachmentItem?.name || ""}|${attachmentItem?.size || 0}`,
  ).trim();
}

function toAttachmentContentKey(attachmentItem = {}) {
  const name = String(attachmentItem?.name || "").trim();
  const size = Number(attachmentItem?.size);
  if (!name || !Number.isFinite(size) || size <= 0) return "";
  return `${name}|${size}`;
}

function normalizeComparablePath(pathValue = "") {
  return String(pathValue || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^file:\/\//, "")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
}

function getAttachmentComparablePaths(attachmentItem = {}) {
  return [
    attachmentItem?.path,
    attachmentItem?.filePath,
    attachmentItem?.resolvedPath,
    attachmentItem?.relativePath,
    attachmentItem?.transferFilePath,
    attachmentItem?.pathView?.sandboxPath,
    attachmentItem?.pathView?.workspacePath,
  ]
    .map(normalizeComparablePath)
    .filter(Boolean);
}

function getWrittenComparablePaths(fileItem = {}) {
  return [
    fileItem?.resolvedPath,
    fileItem?.relativePath,
    fileItem?.path,
    fileItem?.filePath,
    fileItem?.transferFilePath,
  ]
    .map(normalizeComparablePath)
    .filter(Boolean);
}

function areComparablePathsSame(left = "", right = "") {
  const a = normalizeComparablePath(left);
  const b = normalizeComparablePath(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function toWrittenFileContentKey(fileItem = {}) {
  const name = String(fileItem?.fileName || fileItem?.name || resolveBaseName(fileItem?.relativePath || fileItem?.resolvedPath || "")).trim();
  const size = Number(fileItem?.size);
  if (!name || !Number.isFinite(size) || size <= 0) return "";
  return `${name}|${size}`;
}

function isWrittenFileBackedByAttachment(fileItem = {}, attachments = []) {
  const writtenPaths = getWrittenComparablePaths(fileItem);
  const writtenContentKey = toWrittenFileContentKey(fileItem);
  for (const attachmentItem of Array.isArray(attachments) ? attachments : []) {
    const attachmentPaths = getAttachmentComparablePaths(attachmentItem);
    if (
      writtenPaths.length &&
      attachmentPaths.length &&
      writtenPaths.some((writtenPath) =>
        attachmentPaths.some((attachmentPath) => areComparablePathsSame(writtenPath, attachmentPath)),
      )
    ) {
      return true;
    }
    if (writtenContentKey && writtenContentKey === toAttachmentContentKey(attachmentItem)) {
      return true;
    }
  }
  return false;
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

function createFileAccessTraceId(prefix = "files") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskWorkspacePath(pathValue = "") {
  const normalized = String(pathValue || "").trim().replaceAll("\\", "/");
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `${parts.slice(0, 2).join("/")}/.../${parts.at(-1)}`;
}

function logGeneratedFileAccess(event, payload = {}) {
  try {
    const entry = {
      layer: "client.messageFiles",
      event,
      ...payload,
    };
    console.info("[noobot:file-access]", entry);
    window?.noobotDesktop?.logFileAccess?.(entry).catch?.(() => {});
  } catch {}
}

export function useMessageFiles({
  getMessageItem = () => ({}),
  getAllMessages = () => [],
  getSessionDocs = () => [],
  getUserId = () => "",
} = {}) {
  function resolveRelativeWorkspacePath(absolutePath = "") {
    const traceId = createFileAccessTraceId("normalize");
    const normalizedUserId = String(getUserId() || "").trim();
    const normalizedPath = String(absolutePath || "").trim();
    if (!normalizedPath) {
      logGeneratedFileAccess("normalize.emptyPath", { traceId, hasUserId: Boolean(normalizedUserId) });
      return "";
    }
    if (normalizedUserId) {
      const marker = `/workspace/${normalizedUserId}/`;
      const idx = normalizedPath.indexOf(marker);
      if (idx >= 0) {
        const relativePath = sanitizeWorkspaceRelativePath(normalizedPath.slice(idx + marker.length));
        logGeneratedFileAccess("normalize.explicitWorkspace", {
          traceId,
          hasUserId: true,
          input: maskWorkspacePath(normalizedPath),
          relativePath: maskWorkspacePath(relativePath),
          ok: Boolean(relativePath),
        });
        return relativePath;
      }
    }
    const genericWorkspaceMarker = "/workspace/";
    const genericMarkerIndex = normalizedPath.indexOf(genericWorkspaceMarker);
    if (genericMarkerIndex < 0) {
      logGeneratedFileAccess("normalize.notWorkspacePath", {
        traceId,
        hasUserId: Boolean(normalizedUserId),
        input: maskWorkspacePath(normalizedPath),
      });
      return "";
    }
    const genericRelativePath = sanitizeWorkspaceRelativePath(
      normalizedPath.slice(genericMarkerIndex + genericWorkspaceMarker.length),
    );
    if (!genericRelativePath) return "";
    // Backend tool summaries can arrive before the desktop client has a stable
    // userId prop, especially in packaged Electron replay/hydration.  Absolute
    // paths are still rooted as /workspace/<userId>/..., while workspace
    // download APIs expect the path below that user directory.  If we cannot
    // match the explicit user marker above, treat the first segment after
    // /workspace/ as the user workspace directory and keep the remainder.
    const slashIndex = genericRelativePath.indexOf("/");
    if (slashIndex > 0) {
      const relativePath = sanitizeWorkspaceRelativePath(genericRelativePath.slice(slashIndex + 1));
      logGeneratedFileAccess("normalize.genericWorkspace", {
        traceId,
        hasUserId: Boolean(normalizedUserId),
        input: maskWorkspacePath(normalizedPath),
        relativePath: maskWorkspacePath(relativePath),
        ok: Boolean(relativePath),
      });
      return relativePath;
    }
    logGeneratedFileAccess("normalize.genericWorkspaceNoUserSegment", {
      traceId,
      hasUserId: Boolean(normalizedUserId),
      input: maskWorkspacePath(normalizedPath),
      relativePath: maskWorkspacePath(genericRelativePath),
      ok: Boolean(genericRelativePath),
    });
    return genericRelativePath;
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
      const genericRelativePath = sanitizeWorkspaceRelativePath(
        normalizedPath.slice(genericMarkerIndex + genericWorkspaceMarker.length),
      );
      const slashIndex = genericRelativePath.indexOf("/");
      const relativePath = slashIndex > 0
        ? sanitizeWorkspaceRelativePath(genericRelativePath.slice(slashIndex + 1))
        : genericRelativePath;
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

  const rawWrittenFiles = computed(() => {
    const messageItem = getMessageItem() || {};
    if (isFreshPendingAssistant(messageItem)) return [];
    const canUseAssociatedTurnArtifacts = !isAssistantWithoutTurnScope(messageItem);
    const turnScopeId = getMessageTurnScopeId(messageItem);
    const out = [];
    const seen = new Set();
    if (canUseAssociatedTurnArtifacts) {
      for (const logItem of Array.isArray(messageItem?.completedToolLogs) ? messageItem.completedToolLogs : []) {
        for (const fileItem of Array.isArray(logItem?.writtenFiles) ? logItem.writtenFiles : []) {
          if (!fileItem?.fileName && !fileItem?.resolvedPath) continue;
          const normalizedFileItem = {
            toolName: fileItem?.toolName || "write_file",
            resolvedPath: fileItem?.resolvedPath || "",
            fileName: fileItem?.fileName || resolveBaseName(fileItem?.resolvedPath || ""),
            relativePath: fileItem?.relativePath || resolveRelativeWorkspacePath(fileItem?.resolvedPath || ""),
            size: fileItem?.size,
            mimeType: fileItem?.mimeType || fileItem?.type || "",
            sourceType: fileItem?.sourceType || "tool",
            recognized: fileItem?.recognized === true,
          };
          logGeneratedFileAccess("writtenFile.normalized", {
            traceId: createFileAccessTraceId("written"),
            sourceType: normalizedFileItem.sourceType,
            hasFileName: Boolean(normalizedFileItem.fileName),
            hasResolvedPath: Boolean(normalizedFileItem.resolvedPath),
            hasRelativePath: Boolean(normalizedFileItem.relativePath),
            relativePath: maskWorkspacePath(normalizedFileItem.relativePath),
          });
          const fileKey = toWrittenFileKey(normalizedFileItem);
          if (fileKey && seen.has(fileKey)) continue;
          if (fileKey) seen.add(fileKey);
          out.push(normalizedFileItem);
        }
      }
    }
    const candidateMessages = [
      ...(Array.isArray(getAllMessages()) ? getAllMessages() : []),
      ...flattenSessionMessagesWithSessionId(getSessionDocs()),
    ];
    if (turnScopeId) {
      for (const sessionMessage of candidateMessages) {
        if (getMessageRole(sessionMessage) !== "tool") continue;
        if (!isSameMessageRound(messageItem, sessionMessage)) continue;
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
        logGeneratedFileAccess("writtenFile.normalized", {
          traceId: createFileAccessTraceId("written"),
          sourceType: fileItem.sourceType,
          hasFileName: Boolean(fileItem.fileName),
          hasResolvedPath: Boolean(fileItem.resolvedPath),
          hasRelativePath: Boolean(fileItem.relativePath),
          relativePath: maskWorkspacePath(fileItem.relativePath),
        });
        const fileKey = toWrittenFileKey(fileItem);
        if (fileKey && seen.has(fileKey)) continue;
        if (fileKey) seen.add(fileKey);
        out.push(fileItem);
      }
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

  const displayedAttachments = computed(() => {
    const messageItem = getMessageItem() || {};
    const baseAttachments = filterAttachmentsForMessage(
      getMessageAttachments(messageItem),
      messageItem,
    );
    const canUseAssociatedTurnArtifacts = !isAssistantWithoutTurnScope(messageItem);
    const toolLogAttachments = [];
    if (canUseAssociatedTurnArtifacts) {
      for (const logItem of Array.isArray(messageItem?.completedToolLogs) ? messageItem.completedToolLogs : []) {
        toolLogAttachments.push(
          ...(Array.isArray(logItem?.attachments) ? logItem.attachments : []),
        );
      }
    }
    const mergedBaseAttachments = toolLogAttachments.length
      ? mergeAttachments(baseAttachments, toolLogAttachments)
      : baseAttachments;
    if (getMessageRole(messageItem) !== "assistant") {
      return mergedBaseAttachments;
    }
    if (isFreshPendingAssistant(messageItem)) {
      return withAttachmentOwners(mergedBaseAttachments);
    }
    const rootTurnScopeId = getMessageTurnScopeId(messageItem);
    if (!rootTurnScopeId) return withAttachmentOwners(mergedBaseAttachments);

    const allMessages = Array.isArray(getAllMessages()) ? getAllMessages() : [];
    const sessionDocMessages = flattenSessionMessagesWithSessionId(getSessionDocs());
    const candidateMessages = [
      ...allMessages,
      ...sessionDocMessages,
    ];
    const baseSplit = splitAttachmentsByOwner(mergedBaseAttachments);
    let mainFlowAttachments = [...baseSplit.agent];
    let pluginAttachments = [...baseSplit.plugin];
    for (const sessionMessage of candidateMessages) {
      const messageRole = getMessageRole(sessionMessage);
      // Newer messages and generated attachments are scoped by sessionId +
      // turnScopeId.  When the target assistant has a turn scope, treat that as
      // the source of truth and never fall back to dialogProcessId/linear-window
      // collection; otherwise a pending assistant can temporarily collect files
      // from a previous summary/sessionDocs turn.
      if (!isSameExplicitTurnScope(messageItem, sessionMessage)) continue;
      if (!shouldCollectAttachmentsFromMessage(messageItem, sessionMessage)) {
        continue;
      }
      const currentAttachments = filterAttachmentsForMessage(
        getMessageAttachments(sessionMessage),
        messageItem,
      );
      if (!currentAttachments.length) continue;
      const splitCurrentAttachments = splitAttachmentsByOwner(currentAttachments);
      if (
        messageRole === "user" &&
        isHarnessPluginInjectedMessage(sessionMessage)
      ) {
        pluginAttachments = mergeAttachments(
          pluginAttachments,
          currentAttachments,
        );
        continue;
      }
      if (splitCurrentAttachments.plugin.length) {
        pluginAttachments = mergeAttachments(
          pluginAttachments,
          splitCurrentAttachments.plugin,
        );
      }
      if (!["assistant", "tool"].includes(messageRole)) continue;
      if (!splitCurrentAttachments.agent.length) continue;
      mainFlowAttachments = mergeAttachments(
        mainFlowAttachments,
        splitCurrentAttachments.agent,
      );
    }
    const mergedWithOwnerType = withAttachmentOwners([
      ...mainFlowAttachments,
      ...pluginAttachments,
    ]);
    const dedupedWithOwnerType = [];
    const seenAttachmentKeySet = new Map();
    const seenAttachmentContentKeySet = new Map();
    for (const attachmentItem of mergedWithOwnerType) {
      const attachmentKey = toAttachmentKey(attachmentItem);
      const attachmentContentKey = toAttachmentContentKey(attachmentItem);
      const attachmentKeys = [attachmentKey]
        .map((key) => String(key || "").trim())
        .filter(Boolean);
      if (!attachmentKey) {
        dedupedWithOwnerType.push(attachmentItem);
        if (attachmentContentKey) {
          seenAttachmentContentKeySet.set(attachmentContentKey, dedupedWithOwnerType.length - 1);
        }
        continue;
      }
      let existingIndex = attachmentKeys
        .map((key) => seenAttachmentKeySet.get(key))
        .find((index) => index !== undefined);
      if (existingIndex === undefined && attachmentContentKey) {
        const sameContentIndex = seenAttachmentContentKeySet.get(attachmentContentKey);
        const existingSameContentItem = dedupedWithOwnerType[sameContentIndex] || {};
        if (
          getAttachmentOwnerType(attachmentItem) === "plugin" ||
          getAttachmentOwnerType(existingSameContentItem) === "plugin"
        ) {
          existingIndex = sameContentIndex;
        }
      }
      if (existingIndex === undefined) {
        for (const key of attachmentKeys) {
          if (!seenAttachmentKeySet.has(key)) {
            seenAttachmentKeySet.set(key, dedupedWithOwnerType.length);
          }
        }
        if (attachmentContentKey && !seenAttachmentContentKeySet.has(attachmentContentKey)) {
          seenAttachmentContentKeySet.set(attachmentContentKey, dedupedWithOwnerType.length);
        }
        dedupedWithOwnerType.push(attachmentItem);
        continue;
      }
      const existingItem = dedupedWithOwnerType[existingIndex] || {};
      if (
        getAttachmentOwnerType(attachmentItem) === "plugin" &&
        getAttachmentOwnerType(existingItem) !== "plugin"
      ) {
        dedupedWithOwnerType[existingIndex] = {
          ...existingItem,
          ...attachmentItem,
        };
        for (const key of attachmentKeys) {
          seenAttachmentKeySet.set(key, existingIndex);
        }
        if (attachmentContentKey) {
          seenAttachmentContentKeySet.set(attachmentContentKey, existingIndex);
        }
        continue;
      }
      if (
        getAttachmentOwnerType(existingItem) === "plugin" &&
        getAttachmentOwnerType(attachmentItem) !== "plugin"
      ) {
        const preservedPluginItem = {
          ...attachmentItem,
          ...existingItem,
        };
        dedupedWithOwnerType[existingIndex] = preservedPluginItem;
        for (const key of attachmentKeys) {
          seenAttachmentKeySet.set(key, existingIndex);
        }
        if (attachmentContentKey) {
          seenAttachmentContentKeySet.set(attachmentContentKey, existingIndex);
        }
      }
    }
    return dedupedWithOwnerType;
  });

  const writtenFiles = computed(() =>
    rawWrittenFiles.value.filter(
      (fileItem) => !isWrittenFileBackedByAttachment(fileItem, displayedAttachments.value),
    ),
  );

  return {
    writtenFiles,
    displayedAttachments,
  };
}
