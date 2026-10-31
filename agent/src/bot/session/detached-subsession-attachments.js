/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ATTACHMENT_SOURCE, projectAttachmentIdentity } from "@noobot/attachment-protocol";
import { text } from "@noobot/shared/value";

export async function transferCanonicalAttachmentsToSubSession({
  attachmentService,
  userId,
  parentSessionId,
  subSessionId,
  attachments,
}) {
  if (!Array.isArray(attachments)) {
    throw new TypeError("detached sub-session attachments must be an array");
  }
  const output = [];
  for (const attachment of attachments) {
    output.push(
      await transferCanonicalAttachment({
        attachmentService,
        userId,
        parentSessionId,
        subSessionId,
        identity: projectAttachmentIdentity(attachment),
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
  identity,
}) {
  if (identity.sessionId !== parentSessionId) {
    throw new Error("detached sub-session attachment must belong to its parent session");
  }
  const query = { userId, ...identity };
  const parentRecord = await attachmentService.getAttachmentById(query);
  if (!parentRecord) {
    throw new Error("detached sub-session source attachment does not exist in its parent session");
  }
  const sourceContent = await attachmentService.readAttachmentContent(query);
  if (!sourceContent?.content) {
    throw new Error("detached sub-session source attachment content is unavailable");
  }
  const [transferred] = await attachmentService.ingest({
    userId,
    sessionId: subSessionId,
    attachmentSource: ATTACHMENT_SOURCE.USER,
    attachments: [
      {
        name: parentRecord.name,
        mimeType: parentRecord.mimeType,
        contentBase64: sourceContent.content.toString("base64"),
      },
    ],
  });
  if (text(transferred?.sessionId) !== subSessionId) {
    throw new Error("detached sub-session attachment transfer did not create child ownership");
  }
  return transferred;
}
