/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "@noobot/shared/value";

export async function resolveRootSessionId({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
} = {}) {
  if (typeof sessionManager?.getRootSessionId !== "function") {
    throw new TypeError("resolveRootSessionId requires sessionManager.getRootSessionId");
  }
  const normalizedUserId = text(userId);
  const rootAnchorSessionId = text(parentSessionId || sessionId);
  if (!normalizedUserId || !rootAnchorSessionId) {
    throw new TypeError("resolveRootSessionId requires userId and sessionId");
  }
  return sessionManager.getRootSessionId({
    userId: normalizedUserId,
    sessionId: rootAnchorSessionId,
  });
}
