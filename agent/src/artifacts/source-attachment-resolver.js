/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  getRuntimeFromAgentContext,
  getSessionIdsFromAgentContext,
} from "../context/agent-context-accessor.js";
import { resolveRuntimeUserMessageAttachments } from "./runtime-user-message-attachments.js";

export async function resolveCanonicalUserSourceAttachment({
  attachmentId = "",
  filePath = "",
  agentContext = {},
} = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const normalizedAttachmentId = String(attachmentId || "").trim();
  const normalizedFilePath = String(filePath || "").trim().replaceAll("\\", "/");
  if (!normalizedAttachmentId && !normalizedFilePath) return null;

  const runtimeAttachmentMetas = resolveRuntimeUserMessageAttachments(runtime);
  const runtimeMatch = normalizedAttachmentId
    ? runtimeAttachmentMetas.find(
      (item) => String(item?.attachmentId || "").trim() === normalizedAttachmentId,
    ) || null
    : resolveUniqueAttachmentByPath(runtimeAttachmentMetas, normalizedFilePath);
  if (runtimeMatch) return runtimeMatch;

  const attachmentService = runtime?.attachmentService || null;
  const { userId, sessionId, parentSessionId, rootSessionId } =
    getSessionIdsFromAgentContext(agentContext, runtime);
  const sourceSessionId = parentSessionId || rootSessionId || sessionId;
  if (!normalizedAttachmentId || !attachmentService?.resolveSourceAttachment || !userId || !sourceSessionId) return null;

  return attachmentService.resolveSourceAttachment({
    userId,
    sessionId: sourceSessionId,
    attachmentId: normalizedAttachmentId,
    attachmentSource: "user",
  });
}

function resolveUniqueAttachmentByPath(attachments = [], normalizedFilePath = "") {
  const candidates = attachments.map((attachment) => ({
    attachment,
    paths: [attachment?.path, attachment?.relativePath, attachment?.sandboxPath]
      .map((value) => String(value || "").trim().replaceAll("\\", "/"))
      .filter(Boolean),
  }));
  const exactMatch = candidates.find(({ paths }) => paths.includes(normalizedFilePath));
  if (exactMatch) return exactMatch.attachment;
  const suffixMatches = candidates.filter(({ paths }) => paths.some(
    (candidate) => candidate.endsWith(`/${normalizedFilePath}`) || normalizedFilePath.endsWith(`/${candidate}`),
  ));
  return suffixMatches.length === 1 ? suffixMatches[0].attachment : null;
}
