/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { ATTACHMENT_SOURCE, assertAttachmentIngestResult } from "@noobot/attachment-protocol";
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
  if (!Array.isArray(userMessageAttachments))
    throw new TypeError("userMessageAttachments must be an array");
  const sourceAttachments = userMessageAttachments;
  if (!sourceAttachments.length) return [];
  const isCanonical = (attachmentItem) =>
    text(attachmentItem?.attachmentId) &&
    text(attachmentItem?.sessionId) &&
    text(attachmentItem?.attachmentSource) &&
    text(attachmentItem?.path);
  const mapCanonical = (attachmentItem) => mapAttachmentRecordsToMetas([attachmentItem])[0];
  const rawAttachments = sourceAttachments.filter((attachmentItem) => !isCanonical(attachmentItem));
  const ingested = rawAttachments.length
    ? await attachmentService.ingest({
        userId,
        sessionId,
        attachmentSource: ATTACHMENT_SOURCE.USER,
        attachments: rawAttachments,
      })
    : [];
  assertAttachmentIngestResult(rawAttachments, ingested);
  let ingestedIndex = 0;
  return sourceAttachments.map((attachmentItem) => {
    if (isCanonical(attachmentItem)) {
      return mapCanonical(attachmentItem);
    }
    const resolved = ingested[ingestedIndex];
    ingestedIndex += 1;
    return resolved;
  });
}
