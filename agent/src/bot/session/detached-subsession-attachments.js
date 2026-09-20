/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";

export async function transferCanonicalAttachmentsToSubSession({
  attachmentService = null,
  userId = "",
  parentSessionId = "",
  subSessionId = "",
  attachments = [],
  attachmentPolicy = {},
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
        attachmentPolicy,
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
  attachmentPolicy,
}) {
  const attachmentId = String(attachment?.attachmentId || "").trim();
  const path = String(attachment?.path || "").trim();
  if (!attachmentId || !path) return attachment;
  const attachmentSessionId = String(attachment?.sessionId || "").trim();
  if (attachmentSessionId === subSessionId) return attachment;
  assertParentAttachmentOwnership(attachmentSessionId, parentSessionId);
  assertCanonicalAttachmentService(attachmentService);
  const attachmentSource =
    String(attachment?.attachmentSource || ATTACHMENT_SOURCE.USER).trim() || ATTACHMENT_SOURCE.USER;
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
    attachmentPolicy:
      attachmentPolicy && typeof attachmentPolicy === "object" ? attachmentPolicy : {},
    attachments: [
      createTransferredAttachment(attachment, parentRecord, sourceContent, attachmentId),
    ],
  });
  if (!transferred || String(transferred?.sessionId || "").trim() !== subSessionId) {
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
  if (requiredMethods.every((method) => typeof attachmentService?.[method] === "function")) return;
  throw new Error("detached sub-session canonical attachment transfer requires AttachmentService");
}

function createTransferredAttachment(attachment, parentRecord, sourceContent, attachmentId) {
  return {
    clientAttachmentId: String(
      attachment?.clientAttachmentId || `session-transfer:${attachmentId}`,
    ).trim(),
    name: String(parentRecord?.name || attachment?.name || "attachment").trim(),
    mimeType: String(
      parentRecord?.mimeType || attachment?.mimeType || "application/octet-stream",
    ).trim(),
    contentBase64: sourceContent.content.toString("base64"),
    ...(typeof attachment?.isSandbox === "boolean" ? { isSandbox: attachment.isSandbox } : {}),
  };
}
