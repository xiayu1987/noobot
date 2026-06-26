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
  inputAttachments = null,
  attachments = [],
  userId = "",
  sessionId = "",
} = {}) {
  if (!attachmentService || !runtimeBasePath) return [];
  const attachmentPolicy =
    effectiveConfig?.attachments && typeof effectiveConfig.attachments === "object"
      ? effectiveConfig.attachments
      : {};
  const sourceAttachments = Array.isArray(inputAttachments)
    ? inputAttachments
    : Array.isArray(attachments)
      ? attachments
      : [];
  const hasIngestedRecords = sourceAttachments.some(
    (attachmentItem) =>
      String(attachmentItem?.attachmentId || "").trim() &&
      String(attachmentItem?.path || "").trim(),
  );
  if (hasIngestedRecords) {
    return sourceAttachments.map((attachmentItem) => {
      const parsedResult = normalizeAttachmentParsedResultMeta(attachmentItem);
      return {
        attachmentId: String(attachmentItem?.attachmentId || ""),
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
    });
  }
  return attachmentService.ingest({
    userId,
    sessionId: sessionId || "",
    attachmentSource: "user",
    attachments: sourceAttachments,
    attachmentPolicy,
  });
}
