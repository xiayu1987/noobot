/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
export async function resolveSessionTreeWithRootSessionId({
  runtimeBasePath = "",
  sessionManager = null,
  userId = "",
  sessionId = "",
  parentSessionId = "",
  now = new Date().toISOString(),
} = {}) {
  const rootAnchorSessionId = String(parentSessionId || sessionId || "").trim();
  if (!runtimeBasePath || !sessionManager?.getSessionTree) {
    return {
      sessionTree: { roots: [], nodes: {}, updatedAt: now },
      rootSessionId: rootAnchorSessionId,
    };
  }
  const sessionTree = await sessionManager.getSessionTree({ userId });
  const rootSessionId =
    sessionManager?.getRootSessionId && userId && rootAnchorSessionId
      ? await sessionManager.getRootSessionId({
          userId,
          sessionId: rootAnchorSessionId,
          sessionTree,
        })
      : rootAnchorSessionId;
  return {
    sessionTree,
    rootSessionId: String(rootSessionId || rootAnchorSessionId).trim(),
  };
}
