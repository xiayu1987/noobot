/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function locateOutboxSessionDir(service, userId, sessionId, persistenceContext) {
  const scope = await service.sessionRepo.locateSessionScope(userId, sessionId, persistenceContext);
  return scope ? scope.sessionDir : "";
}
