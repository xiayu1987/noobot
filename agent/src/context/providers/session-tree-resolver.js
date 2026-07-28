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
  now = new Date().toISOString(),
} = {}) {
  if (!runtimeBasePath || !sessionManager?.getSessionTree) {
    return {
      sessionTree: { roots: [], nodes: {}, updatedAt: now },
      rootSessionId: String(sessionId || "").trim(),
    };
  }
  const sessionTree = await sessionManager.getSessionTree({ userId });
  const rootSessionId =
    sessionManager?.getRootSessionId && userId && sessionId
      ? await sessionManager.getRootSessionId({
          userId,
          sessionId,
          sessionTree,
        })
      : sessionId;
  return {
    sessionTree,
    rootSessionId: String(rootSessionId || sessionId || "").trim(),
  };
}
