/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { text, isFunction } from "@noobot/shared/value";

export async function transferCanonicalAttachmentsToSubSession({
  attachmentService = null,
  userId = "",
  parentSessionId = "",
  subSessionId = "",
  attachments = [],
} = {}) {
  const source = Array.isArray(attachments) ? attachments : [];
  if (!source.length) return [];
  const output = [];
  for (const attachment of source) {
    output.push(
      await transferCanonicalAttachment({
        attachmentService,
        userId,
        parentSessionId,
        subSessionId,
        attachment,
      }),
    );
  }
  return output;
}

async function transferCanonicalAttachment({
  attachmentService,
  userId,
  parentSessionId,
  subSessionId,
  attachment,
}) {
  const attachmentId = text(attachment?.attachmentId);
  const path = text(attachment?.path);
  if (!attachmentId || !path) return attachment;
  const attachmentSessionId = text(attachment?.sessionId);
  if (attachmentSessionId === subSessionId) return attachment;
  assertParentAttachmentOwnership(attachmentSessionId, parentSessionId);
  assertCanonicalAttachmentService(attachmentService);
  const attachmentSource = text(attachment?.attachmentSource) || ATTACHMENT_SOURCE.USER;
  const parentRecord = await attachmentService.getAttachmentById({
    userId,
    attachmentId,
    sessionId: parentSessionId,
    attachmentSource,
  });
  assertParentAttachmentRecord(parentRecord);
  const sourceContent = await attachmentService.readAttachmentContent({
    userId,
    attachmentId,
    sessionId: parentSessionId,
    attachmentSource,
  });
  assertParentAttachmentContent(sourceContent);
  const [transferred] = await attachmentService.ingest({
    userId,
    sessionId: subSessionId,
    attachmentSource: ATTACHMENT_SOURCE.USER,
    attachments: [createTransferredAttachment(attachment, parentRecord, sourceContent)],
  });
  if (!transferred || text(transferred?.sessionId) !== subSessionId) {
    throw new Error("detached sub-session attachment transfer did not create child ownership");
  }
  return transferred;
}

function assertParentAttachmentOwnership(attachmentSessionId, parentSessionId) {
  if (attachmentSessionId === parentSessionId) return;
  throw new Error("detached sub-session attachment must belong to its parent session");
}

function assertParentAttachmentRecord(parentRecord) {
  if (parentRecord) return;
  throw new Error("detached sub-session source attachment does not exist in its parent session");
}

function assertParentAttachmentContent(sourceContent) {
  if (sourceContent?.content) return;
  throw new Error("detached sub-session source attachment content is unavailable");
}

function assertCanonicalAttachmentService(attachmentService) {
  const requiredMethods = ["getAttachmentById", "readAttachmentContent", "ingest"];
  if (requiredMethods.every((method) => isFunction(attachmentService?.[method]))) return;
  throw new Error("detached sub-session canonical attachment transfer requires AttachmentService");
}

function createTransferredAttachment(attachment, parentRecord, sourceContent) {
  return {
    name: String(parentRecord?.name || attachment?.name || "attachment").trim(),
    mimeType: String(
      parentRecord?.mimeType || attachment?.mimeType || "application/octet-stream",
    ).trim(),
    contentBase64: sourceContent.content.toString("base64"),
  };
}
