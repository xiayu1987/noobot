/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { isWorkspacePathSegment } from "./layout.js";

export const SESSION_TOMBSTONE_ERROR = Object.freeze({
  INVALID: "SESSION_TOMBSTONE_INVALID",
});

export function requireSessionTombstoneSessions(tombstone, details) {
  const sessions = isPlainObject(tombstone) ? tombstone.sessions : undefined;
  const valid =
    isPlainObject(sessions) &&
    Object.entries(sessions).every(
      ([sessionId, deletedAt]) => isWorkspacePathSegment(sessionId) && Number.isFinite(deletedAt),
    );
  if (!valid) {
    const error = new TypeError(
      "session tombstone must be { sessions: { [sessionId]: deletedAtMs } }",
    );
    error.code = SESSION_TOMBSTONE_ERROR.INVALID;
    error.details = details;
    throw error;
  }
  return sessions;
}
