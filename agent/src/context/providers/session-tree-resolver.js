/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export async function resolveRootSessionId({
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
} = {}) {
  if (typeof sessionManager?.getRootSessionId !== "function") {
    throw new TypeError("resolveRootSessionId requires sessionManager.getRootSessionId");
  }
  const normalizedUserId = String(userId || "").trim();
  const rootAnchorSessionId = String(parentSessionId || sessionId || "").trim();
  if (!normalizedUserId || !rootAnchorSessionId) {
    throw new TypeError("resolveRootSessionId requires userId and sessionId");
  }
  return sessionManager.getRootSessionId({
    userId: normalizedUserId,
    sessionId: rootAnchorSessionId,
  });
}
