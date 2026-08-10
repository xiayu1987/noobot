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
  agentContext = {},
} = {}) {
  const runtime = getRuntimeFromAgentContext(agentContext);
  const normalizedAttachmentId = String(attachmentId || "").trim();
  if (!normalizedAttachmentId) return null;

  const runtimeAttachmentMetas = resolveRuntimeUserMessageAttachments(runtime);
  const runtimeMatch = runtimeAttachmentMetas.find(
    (item) => String(item?.attachmentId || "").trim() === normalizedAttachmentId,
  ) || null;
  if (runtimeMatch) return runtimeMatch;

  const attachmentService = runtime?.attachmentService || null;
  const { userId, sessionId, parentSessionId, rootSessionId } =
    getSessionIdsFromAgentContext(agentContext, runtime);
  const sourceSessionId = parentSessionId || rootSessionId || sessionId;
  if (!attachmentService?.resolveSourceAttachment || !userId || !sourceSessionId) return null;

  return attachmentService.resolveSourceAttachment({
    userId,
    sessionId: sourceSessionId,
    attachmentId: normalizedAttachmentId,
    attachmentSource: "user",
  });
}
