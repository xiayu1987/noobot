/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export async function resolveRootSessionId({
  runtimeBasePath = "",
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
} = {}) {
  const rootAnchorSessionId = String(parentSessionId || sessionId || "").trim();
  if (!runtimeBasePath || !sessionManager?.getRootSessionId || !userId || !rootAnchorSessionId) {
    return rootAnchorSessionId;
  }
  const rootSessionId = await sessionManager.getRootSessionId({
    userId,
    sessionId: rootAnchorSessionId,
  });
  return String(rootSessionId || rootAnchorSessionId).trim();
}
