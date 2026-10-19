/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { text } from "@noobot/shared/value";

export const SESSION_ERROR_CODE = Object.freeze({
  AGGREGATE_VERSION_CONFLICT: "SESSION_AGGREGATE_VERSION_CONFLICT",
  AGGREGATE_VERSION_INVALID: "SESSION_AGGREGATE_VERSION_INVALID",
  IDEMPOTENCY_KEY_REUSED: "SESSION_IDEMPOTENCY_KEY_REUSED",
  CONTINUE_AUTHORITY_MISMATCH: "SESSION_CONTINUE_AUTHORITY_MISMATCH",
  TURN_ATTACHMENTS_ALREADY_BOUND: "SESSION_TURN_ATTACHMENTS_ALREADY_BOUND",
  SESSION_DELETED: "SESSION_DELETED",
  PARENT_SESSION_SCOPE_CONFLICT: "SESSION_PARENT_SESSION_SCOPE_CONFLICT",
  SESSION_TREE_NODE_CONFLICT: "SESSION_TREE_NODE_CONFLICT",
});

export const SESSION_DELETED_REASON = "session_deleted";

export function createSessionDeletedError({ userId = "", sessionId = "", operation = "" } = {}) {
  const normalizedSessionId = text(sessionId);
  const error = new Error(`session has been deleted: ${normalizedSessionId}`);
  error.statusCode = 410;
  error.code = SESSION_ERROR_CODE.SESSION_DELETED;
  error.userId = text(userId);
  error.sessionId = normalizedSessionId;
  if (operation) error.operation = String(operation);
  return error;
}

export function isSessionDeletedError(error) {
  return error?.code === SESSION_ERROR_CODE.SESSION_DELETED;
}
