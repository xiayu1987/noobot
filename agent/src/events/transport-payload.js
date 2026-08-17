/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { createAttachmentLifecycleEvent } from "@noobot/attachment-protocol";
import { normalizeParentSessionId } from "@noobot/session-protocol";

export function projectExecutionTransportPayload({ event = "", data = {}, route = {} } = {}) {
  const eventData = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  if (event === "attachment_lifecycle") return createAttachmentLifecycleEvent(eventData);
  const userId = String(eventData.userId || route.userId || "").trim();
  return {
    ...eventData,
    ...(userId ? { userId } : {}),
    dialogProcessId: String(eventData.dialogProcessId || route.dialogProcessId || "").trim(),
    sessionId: String(eventData.sessionId || route.sessionId || ""),
    turnScopeId: String(eventData.turnScopeId || route.turnScopeId || ""),
    parentSessionId: normalizeParentSessionId(
      eventData.parentSessionId || route.parentSessionId,
    ),
  };
}
