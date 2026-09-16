/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function readRepositoryParentSessionId(
  sessionRepo,
  userId,
  sessionId,
  parentSessionId = "",
  persistenceContext = null,
) {
  if (typeof sessionRepo?.resolveSessionScope === "function") {
    const scope = await sessionRepo.resolveSessionScope(
      userId,
      sessionId,
      parentSessionId,
      persistenceContext,
    );
    return scope?.resolvedParentSessionId || "";
  }
  return sessionRepo.resolveParentSessionId(userId, sessionId, parentSessionId);
}
