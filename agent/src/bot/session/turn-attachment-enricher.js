/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isInjectedOrPluginMessage } from "@noobot/context-protocol/policy/message";
import { readAttachIndex } from "../../artifacts/index.js";
import { ATTACHMENT_SOURCE, findAttachmentByIdentity } from "@noobot/attachment-protocol";
import { isPlainObject, text, isFunction } from "@noobot/shared/value";

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
    if (text(messageItem?.role) !== "user") continue;
    if (isInjectedOrPluginMessage(messageItem)) continue;
    const sameTurn = turnScopeId && text(messageItem?.turnScopeId) === turnScopeId;
    const sameDialog = dialogProcessId && text(messageItem?.dialogProcessId) === dialogProcessId;
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
  const normalizedSessionId = text(sessionId);
  const basePath = await resolveAttachmentIndexBasePath(engine, userId);
  let index = null;
  if (basePath && normalizedSessionId) {
    index = await readAttachIndex(basePath, {
      sessionId: normalizedSessionId,
      attachmentSource: ATTACHMENT_SOURCE.USER,
    });
  }
  const indexedAttachments = Object.values(index?.attachments || {}).filter((item) =>
    isPlainObject(item),
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
  const normalizedUserId = text(userId);
  if (!normalizedUserId) return "";
  if (!isFunction(engine.workspaceService?.ensureUserWorkspace)) {
    throw new TypeError("attachment enrichment requires WorkspaceService");
  }
  const basePath = await engine.workspaceService.ensureUserWorkspace(normalizedUserId);
  const normalizedBasePath = text(basePath);
  if (!normalizedBasePath) throw new Error("WorkspaceService returned an empty workspace path");
  return normalizedBasePath;
}
