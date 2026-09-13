/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export async function resolveOutboxSessionDir(
  service,
  userId,
  sessionId,
  resolvedParentSessionId = "",
  persistenceContext = null,
) {
  if (typeof service?.sessionRepo?.resolveSessionScope !== "function") return "";
  const scope = await service.sessionRepo.resolveSessionScope(
    userId,
    sessionId,
    resolvedParentSessionId,
    persistenceContext,
  );
  return String(scope?.sessionDir || "").trim();
}

export async function requireOutboxSessionDir(
  service,
  userId,
  sessionId,
  resolvedParentSessionId = "",
  persistenceContext = null,
) {
  const sessionDir = await resolveOutboxSessionDir(
    service,
    userId,
    sessionId,
    resolvedParentSessionId,
    persistenceContext,
  );
  if (!sessionDir) {
    const error = new Error("authority outbox session directory is unresolved");
    error.code = "OUTBOX_SESSION_DIR_UNRESOLVED";
    throw error;
  }
  return sessionDir;
}
