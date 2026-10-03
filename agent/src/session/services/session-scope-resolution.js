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
  const scope = await sessionRepo.resolveSessionScope(
    userId,
    sessionId,
    parentSessionId,
    persistenceContext,
  );
  return scope.resolvedParentSessionId;
}
