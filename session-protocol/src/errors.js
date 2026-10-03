/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

export const SESSION_ERROR_CODE = Object.freeze({
  AGGREGATE_VERSION_CONFLICT: "SESSION_AGGREGATE_VERSION_CONFLICT",
  IDEMPOTENCY_KEY_REUSED: "SESSION_IDEMPOTENCY_KEY_REUSED",
  CONTINUE_AUTHORITY_MISMATCH: "SESSION_CONTINUE_AUTHORITY_MISMATCH",
  TURN_ATTACHMENTS_ALREADY_BOUND: "SESSION_TURN_ATTACHMENTS_ALREADY_BOUND",
  SESSION_DELETED: "SESSION_DELETED",
});

export const SESSION_DELETED_REASON = "session_deleted";

export function createSessionDeletedError({ userId = "", sessionId = "", operation = "" } = {}) {
  const normalizedSessionId = String(sessionId || "").trim();
  const error = new Error(`session has been deleted: ${normalizedSessionId}`);
  error.statusCode = 410;
  error.code = SESSION_ERROR_CODE.SESSION_DELETED;
  error.userId = String(userId || "").trim();
  error.sessionId = normalizedSessionId;
  if (operation) error.operation = String(operation);
  return error;
}

export function isSessionDeletedError(error) {
  return error?.code === SESSION_ERROR_CODE.SESSION_DELETED;
}
