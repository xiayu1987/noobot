/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeNum } from "../../utils/shared-utils.js";
import { MIME_TYPE } from "../../constants/index.js";

export async function resolveAttachments({
  attachmentService = null,
  runtimeBasePath = "",
  effectiveConfig = {},
  inputAttachmentMetas = null,
  attachmentMetas = [],
  userId = "",
  sessionId = "",
} = {}) {
  if (!attachmentService || !runtimeBasePath) return [];
  const attachmentPolicy =
    effectiveConfig?.attachments && typeof effectiveConfig.attachments === "object"
      ? effectiveConfig.attachments
      : {};
  const sourceAttachmentMetas = Array.isArray(inputAttachmentMetas)
    ? inputAttachmentMetas
    : Array.isArray(attachmentMetas)
      ? attachmentMetas
      : [];
  const hasIngestedRecords = sourceAttachmentMetas.some(
    (attachmentItem) =>
      String(attachmentItem?.attachmentId || "").trim() &&
      String(attachmentItem?.path || "").trim(),
  );
  if (hasIngestedRecords) {
    return sourceAttachmentMetas.map((attachmentItem) => ({
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
      parsedResultAttachmentId: String(
        attachmentItem?.parsedResultAttachmentId || "",
      ).trim(),
      parsedResultPath: String(attachmentItem?.parsedResultPath || "").trim(),
      parsedResultRelativePath: String(
        attachmentItem?.parsedResultRelativePath || "",
      ).trim(),
      parsedResultTool: String(attachmentItem?.parsedResultTool || "").trim(),
      parsedResultUpdatedAt: String(
        attachmentItem?.parsedResultUpdatedAt || "",
      ).trim(),
    }));
  }
  return attachmentService.ingest({
    userId,
    sessionId: sessionId || "",
    attachmentSource: "user",
    attachments: sourceAttachmentMetas,
    attachmentPolicy,
  });
}
