/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  findMatchingAttachmentMeta,
  mergeAttachmentMetaPreferRich,
  readAttachIndex,
} from "../../attach/index.js";
import { filePath as path } from "../../utils/path-resolver.js";

/**
 * Turn 附件补齐族。以 engine 为入参回调其字段/方法（session、workspaceService、
 * globalConfig），保持主类方法的薄委托契约与测试可注入桩兼容。
 */

export async function resolveExistingUserMessageAttachments(engine, {
  userId = "",
  sessionId = "",
  parentSessionId = "",
  turnScopeId = "",
  dialogProcessId = "",
} = {}) {
  if (!userId || !sessionId || !engine.session?.findById) return [];
  let sessionDoc = null;
  try {
    sessionDoc = await engine.session.findById(userId, sessionId, parentSessionId);
  } catch {
    return [];
  }
  const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (String(messageItem?.role || "").trim() !== "user") continue;
    if (messageItem?.injectedMessage === true || messageItem?.pluginMessage === true) continue;
    const sameTurn = turnScopeId && String(messageItem?.turnScopeId || "").trim() === turnScopeId;
    const sameDialog = dialogProcessId && String(messageItem?.dialogProcessId || "").trim() === dialogProcessId;
    if (!sameTurn && !sameDialog) continue;
    return Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
  }
  return [];
}

export async function enrichUserInputAttachmentsFromIndex(engine, {
  userId = "",
  sessionId = "",
  attachments = [],
  existingAttachments = [],
} = {}) {
  const sourceAttachments = Array.isArray(attachments) ? attachments : [];
  if (!sourceAttachments.length) return sourceAttachments;
  const normalizedSessionId = String(sessionId || "").trim();
  const basePath = await resolveAttachmentIndexBasePath(engine, userId);
  let index = null;
  if (basePath && normalizedSessionId) {
    try {
      index = await readAttachIndex(basePath, {
        sessionId: normalizedSessionId,
        attachmentSource: "user",
      });
    } catch {
      index = null;
    }
  }
  const indexedAttachments = Object.values(index?.attachments || {}).filter(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
  const richCandidates = [
    ...(Array.isArray(existingAttachments) ? existingAttachments : []),
    ...indexedAttachments,
  ];
  if (!richCandidates.length) return sourceAttachments;
  return sourceAttachments.map((attachmentItem) => {
    const match = findMatchingAttachmentMeta(attachmentItem, richCandidates);
    return match ? mergeAttachmentMetaPreferRich(match, attachmentItem) : attachmentItem;
  });
}

export async function resolveAttachmentIndexBasePath(engine, userId = "") {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return "";
  if (engine.workspaceService?.ensureUserWorkspace) {
    try {
      const basePath = await engine.workspaceService.ensureUserWorkspace(normalizedUserId);
      if (basePath) return String(basePath || "").trim();
    } catch {
      // fall through to globalConfig workspaceRoot
    }
  }
  const workspaceRoot = String(engine.globalConfig?.workspaceRoot || "").trim();
  return workspaceRoot ? path.resolve(workspaceRoot, normalizedUserId) : "";
}
