/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { readAttachIndex } from "../../artifacts/index.js";
import { ATTACHMENT_SOURCE, findAttachmentByIdentity } from "@noobot/attachment-protocol";
import { isFunction } from "@noobot/shared/value";

export async function enrichUserInputAttachmentsFromIndex(
  workspaceService,
  { userId, sessionId, attachments },
) {
  if (!attachments.length) return attachments;
  const basePath = await resolveAttachmentIndexBasePath(workspaceService, userId);
  const index = await readAttachIndex(basePath, {
    sessionId,
    attachmentSource: ATTACHMENT_SOURCE.USER,
  });
  const indexedAttachments = Object.values(index.attachments);
  return attachments.map((attachmentItem) => {
    const indexed = findAttachmentByIdentity(indexedAttachments, attachmentItem);
    return indexed ? { ...attachmentItem, ...indexed } : attachmentItem;
  });
}

async function resolveAttachmentIndexBasePath(workspaceService, userId) {
  if (!isFunction(workspaceService?.ensureUserWorkspace)) {
    throw new TypeError("attachment enrichment requires WorkspaceService");
  }
  const basePath = await workspaceService.ensureUserWorkspace(userId);
  if (typeof basePath !== "string" || !basePath) {
    throw new Error("WorkspaceService returned an empty workspace path");
  }
  return basePath;
}
