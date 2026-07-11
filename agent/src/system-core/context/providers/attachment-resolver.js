/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { mapAttachmentRecordsToMetas } from "../../attach/index.js";

export async function resolveAttachments({
  attachmentService = null,
  runtimeBasePath = "",
  effectiveConfig = {},
  userMessageAttachments = [],
  userId = "",
  sessionId = "",
} = {}) {
  if (!attachmentService || !runtimeBasePath) return [];
  const attachmentPolicy =
    effectiveConfig?.attachments && typeof effectiveConfig.attachments === "object"
      ? effectiveConfig.attachments
      : {};
  const sourceAttachments = Array.isArray(userMessageAttachments)
    ? userMessageAttachments
    : [];
  if (!sourceAttachments.length) return [];
  const isCanonical = (attachmentItem) =>
    String(attachmentItem?.attachmentId || "").trim() &&
    String(attachmentItem?.path || "").trim();
  const mapCanonical = (attachmentItem) =>
    mapAttachmentRecordsToMetas([{
      ...attachmentItem,
      sessionId: attachmentItem?.sessionId || attachmentItem?.session_id || sessionId,
      attachmentSource:
        attachmentItem?.attachmentSource || attachmentItem?.attachment_source || "user",
    }])[0] || null;
  const rawAttachments = sourceAttachments.filter((attachmentItem) => !isCanonical(attachmentItem));
  const ingested = rawAttachments.length ? await attachmentService.ingest({
    userId,
    sessionId: sessionId || "",
    attachmentSource: "user",
    attachments: rawAttachments,
    attachmentPolicy,
  }) : [];
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
