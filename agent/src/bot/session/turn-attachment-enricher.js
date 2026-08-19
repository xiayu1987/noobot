/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readAttachIndex } from "../../artifacts/index.js";
import { findAttachmentByIdentity } from "@noobot/attachment-protocol";
import { safeStr } from "../../shared/utils/shared-utils.js";

export async function resolveExistingUserMessageAttachments(
  engine,
  {
    userId = "",
    sessionId = "",
    parentSessionId = "",
    turnScopeId = "",
    dialogProcessId = "",
  } = {},
) {
  if (!userId || !sessionId || !engine.session?.findById) return [];
  const sessionDoc = await engine.session.findById(userId, sessionId, parentSessionId);
  const messages = Array.isArray(sessionDoc?.messages) ? sessionDoc.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const messageItem = messages[index];
    if (String(messageItem?.role || "").trim() !== "user") continue;
    if (messageItem?.injectedMessage === true || messageItem?.pluginMessage === true) continue;
    const sameTurn = turnScopeId && String(messageItem?.turnScopeId || "").trim() === turnScopeId;
    const sameDialog =
      dialogProcessId && String(messageItem?.dialogProcessId || "").trim() === dialogProcessId;
    if (!sameTurn && !sameDialog) continue;
    return Array.isArray(messageItem?.attachments) ? messageItem.attachments : [];
  }
  return [];
}

export async function enrichUserInputAttachmentsFromIndex(
  engine,
  { userId = "", sessionId = "", attachments = [], existingAttachments = [] } = {},
) {
  const sourceAttachments = Array.isArray(attachments) ? attachments : [];
  if (!sourceAttachments.length) return sourceAttachments;
  const normalizedSessionId = String(sessionId || "").trim();
  const basePath = await resolveAttachmentIndexBasePath(engine, userId);
  let index = null;
  if (basePath && normalizedSessionId) {
    index = await readAttachIndex(basePath, {
      sessionId: normalizedSessionId,
      attachmentSource: "user",
    });
  }
  const indexedAttachments = Object.values(index?.attachments || {}).filter(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
  const sessionAttachments = Array.isArray(existingAttachments) ? existingAttachments : [];
  return sourceAttachments.map((attachmentItem) => {
    if (
      !attachmentItem?.attachmentId ||
      !attachmentItem?.sessionId ||
      !attachmentItem?.attachmentSource
    )
      return attachmentItem;
    const indexed = findAttachmentByIdentity(indexedAttachments, attachmentItem);
    if (indexed) return { ...attachmentItem, ...indexed };
    const persistedSnapshot = findAttachmentByIdentity(sessionAttachments, attachmentItem);
    return persistedSnapshot ? { ...attachmentItem, ...persistedSnapshot } : attachmentItem;
  });
}

export async function resolveAttachmentIndexBasePath(engine, userId = "") {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) return "";
  if (typeof engine.workspaceService?.ensureUserWorkspace !== "function") {
    throw new TypeError("attachment enrichment requires WorkspaceService");
  }
  const basePath = await engine.workspaceService.ensureUserWorkspace(normalizedUserId);
  const normalizedBasePath = String(basePath || "").trim();
  if (!normalizedBasePath) throw new Error("WorkspaceService returned an empty workspace path");
  return normalizedBasePath;
}
