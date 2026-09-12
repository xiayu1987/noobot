/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

/**
 * Single resolver for the authority outbox session directory.
 *
 * Parent session resolution stays with each caller: turn-state already owns a
 * resolved parent id inside its mutation, and authority-event entries resolve
 * it through `_resolveParentSessionId`. This helper only maps an already
 * resolved scope to its on-disk session directory.
 *
 * `resolveSessionScope` is an optional repository capability (see
 * `SessionMessageService._resolveParentSessionId`), so a repository without it
 * yields an empty directory and read paths degrade to `session_not_found`.
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

/**
 * Commit paths cannot degrade: appending a commit record to a relative path
 * would silently detach the journal from its session, so an unresolved
 * directory is a hard failure.
 */
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
