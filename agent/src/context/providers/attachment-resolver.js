/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ATTACHMENT_SOURCE } from "@noobot/attachment-protocol";
import { mapAttachmentRecordsToMetas } from "../../artifacts/index.js";
import { text, isFunction } from "@noobot/shared/value";

export async function resolveAttachments({
  attachmentService,
  userMessageAttachments = [],
  userId = "",
  sessionId = "",
} = {}) {
  if (!isFunction(attachmentService?.ingest)) {
    throw new TypeError("resolveAttachments requires attachmentService.ingest");
  }
  const sourceAttachments = Array.isArray(userMessageAttachments) ? userMessageAttachments : [];
  if (!sourceAttachments.length) return [];
  const isCanonical = (attachmentItem) =>
    text(attachmentItem?.attachmentId) &&
    text(attachmentItem?.sessionId) &&
    text(attachmentItem?.attachmentSource) &&
    text(attachmentItem?.path);
  const mapCanonical = (attachmentItem) => mapAttachmentRecordsToMetas([attachmentItem])[0] || null;
  const rawAttachments = sourceAttachments.filter((attachmentItem) => !isCanonical(attachmentItem));
  const ingested = rawAttachments.length
    ? await attachmentService.ingest({
        userId,
        sessionId: sessionId || "",
        attachmentSource: ATTACHMENT_SOURCE.USER,
        attachments: rawAttachments,
      })
    : [];
  let ingestedIndex = 0;
  return sourceAttachments.flatMap((attachmentItem) => {
    if (isCanonical(attachmentItem)) {
      const mapped = mapCanonical(attachmentItem);
      return mapped ? [mapped] : [];
    }
    const resolved = ingested[ingestedIndex];
    ingestedIndex += 1;
    return resolved ? [resolved] : [];
  });
}
