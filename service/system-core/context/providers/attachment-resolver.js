/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { safeNum } from "../../utils/shared-utils.js";

export async function resolveAttachments({
  attachmentService = null,
  runtimeBasePath = "",
  effectiveConfig = {},
  attachmentMetas = [],
  userId = "",
  sessionId = "",
} = {}) {
  if (!attachmentService || !runtimeBasePath) return [];
  const attachmentPolicy =
    effectiveConfig?.attachments && typeof effectiveConfig.attachments === "object"
      ? effectiveConfig.attachments
      : {};
  const hasIngestedRecords = (attachmentMetas || []).some(
    (attachmentItem) =>
      String(attachmentItem?.attachmentId || "").trim() &&
      String(attachmentItem?.path || "").trim(),
  );
  if (hasIngestedRecords) {
    return (attachmentMetas || []).map((attachmentItem) => ({
      attachmentId: String(attachmentItem?.attachmentId || ""),
      sessionId: String(attachmentItem?.sessionId || sessionId || ""),
      attachmentSource: String(attachmentItem?.attachmentSource || "user").trim(),
      name: String(attachmentItem?.name || ""),
      mimeType: String(attachmentItem?.mimeType || "application/octet-stream"),
      size: safeNum(attachmentItem?.size),
      path: String(attachmentItem?.path || ""),
      relativePath: String(attachmentItem?.relativePath || ""),
    }));
  }
  return attachmentService.ingest({
    userId,
    sessionId: sessionId || "",
    attachmentSource: "user",
    attachments: attachmentMetas,
    attachmentPolicy,
  });
}
