/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { randomUUID } from "node:crypto";
import { normalizeParentSessionId } from "@noobot/session-protocol";

export const AGENT_DETACHED_SESSION_ROOT = "runtime/agent/session";

export function createAgentDetachedSubSessionStrategy({
  userId = "",
  parentSessionId = "",
  parentDialogProcessId = "",
} = {}) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedParentSessionId = normalizeParentSessionId(parentSessionId);
  const normalizedParentDialogProcessId = String(parentDialogProcessId || "").trim();
  if (!normalizedUserId || !normalizedParentSessionId) {
    throw new TypeError("agent detached sub-session strategy requires userId and parentSessionId");
  }

  const sessionId = randomUUID();
  const dialogProcessId = randomUUID();
  const turnScopeId = `internal-turn:${randomUUID()}`;
  return Object.freeze({
    userId: normalizedUserId,
    sessionId,
    parentSessionId: normalizedParentSessionId,
    parentDialogProcessId: normalizedParentDialogProcessId,
    dialogProcessId,
    turnScopeId,
    executionId: `agent:${turnScopeId}`,
    relativeDir: `${AGENT_DETACHED_SESSION_ROOT}/${sessionId}`,
    allowedRoot: AGENT_DETACHED_SESSION_ROOT,
  });
}
