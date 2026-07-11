/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeNum } from "../../utils/shared-utils.js";
import { MIME_TYPE } from "../../constants/index.js";
import { normalizeAttachmentParsedResultMeta } from "../../attach/index.js";

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
  const mapCanonical = (attachmentItem) => {
      const parsedResult = normalizeAttachmentParsedResultMeta(attachmentItem);
      return {
        attachmentId: String(attachmentItem?.attachmentId || ""),
        ...(String(attachmentItem?.clientAttachmentId || "").trim()
          ? { clientAttachmentId: String(attachmentItem.clientAttachmentId).trim() }
          : {}),
        sessionId: String(attachmentItem?.sessionId || sessionId || ""),
        attachmentSource: String(attachmentItem?.attachmentSource || "user").trim(),
        name: String(attachmentItem?.name || ""),
        mimeType: String(
          attachmentItem?.mimeType || MIME_TYPE.APPLICATION_OCTET_STREAM,
        ),
        size: safeNum(attachmentItem?.size),
        path: String(attachmentItem?.path || ""),
        relativePath: String(attachmentItem?.relativePath || ""),
        ...(parsedResult ? { parsedResult } : {}),
      };
    };
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
    if (isCanonical(attachmentItem)) return [mapCanonical(attachmentItem)];
    const resolved = ingested[ingestedIndex];
    ingestedIndex += 1;
    return resolved ? [resolved] : [];
  });
}
