/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText, text } from "@noobot/shared/value";

export const SESSION_ERROR_CODE = Object.freeze({
  AGGREGATE_VERSION_CONFLICT: "SESSION_AGGREGATE_VERSION_CONFLICT",
  AGGREGATE_VERSION_INVALID: "SESSION_AGGREGATE_VERSION_INVALID",
  IDEMPOTENCY_KEY_REUSED: "SESSION_IDEMPOTENCY_KEY_REUSED",
  CONTINUE_AUTHORITY_MISMATCH: "SESSION_CONTINUE_AUTHORITY_MISMATCH",
  TURN_ATTACHMENTS_ALREADY_BOUND: "SESSION_TURN_ATTACHMENTS_ALREADY_BOUND",
  SESSION_DELETED: "SESSION_DELETED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  TURN_APPEND_REJECTED: "SESSION_TURN_APPEND_REJECTED",
  TURN_MESSAGE_NOT_PERSISTED: "SESSION_TURN_MESSAGE_NOT_PERSISTED",
  TURN_JOURNAL_MESSAGE_MISSING: "SESSION_TURN_JOURNAL_MESSAGE_MISSING",
  MESSAGE_ORDER_MESSAGE_MISSING: "SESSION_MESSAGE_ORDER_MESSAGE_MISSING",
  MANIFEST_LAYOUT_INVALID: "SESSION_MANIFEST_LAYOUT_INVALID",
  TURN_JOURNAL_SCHEMA_REQUIRED: "SESSION_TURN_JOURNAL_SCHEMA_REQUIRED",
  ARTIFACT_NOT_FOUND: "SESSION_ARTIFACT_NOT_FOUND",
  COMPLETION_SUMMARY_REPAIR_REQUIRED: "SESSION_COMPLETION_SUMMARY_REPAIR_REQUIRED",
  SCOPE_IDENTITY_CONFLICT: "SESSION_SCOPE_IDENTITY_CONFLICT",
  COMMAND_RECEIPT_INVALID: "SESSION_COMMAND_RECEIPT_INVALID",
  SESSION_TREE_NODE_CONFLICT: "SESSION_TREE_NODE_CONFLICT",
  TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING: "TURN_SUMMARY_CHECKPOINT_MESSAGE_MISSING",
  TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT: "TURN_SUMMARY_CHECKPOINT_OWNERSHIP_CONFLICT",
  TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT: "TURN_SUMMARY_CHECKPOINT_TOOL_PAIR_SPLIT",
  TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE: "TURN_SUMMARY_CHECKPOINT_TERMINAL_PERSISTENCE",
  TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE: "TURN_SUMMARY_CHECKPOINT_NOT_ACTIVE",
  TURN_SUMMARY_CHECKPOINT_ID_REUSED: "TURN_SUMMARY_CHECKPOINT_ID_REUSED",
  TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT: "TURN_SUMMARY_CHECKPOINT_REVISION_CONFLICT",
  TURN_SUMMARY_CHECKPOINT_DISPOSITION_CONFLICT: "TURN_SUMMARY_CHECKPOINT_DISPOSITION_CONFLICT",
  TURN_SUMMARY_CHECKPOINT_RETAINED_MESSAGE_MISSING:
    "TURN_SUMMARY_CHECKPOINT_RETAINED_MESSAGE_MISSING",
  TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT: "TURN_SUMMARY_CHECKPOINT_MESSAGE_SCOPE_CONFLICT",
  TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID: "TURN_SUMMARY_CHECKPOINT_REQUEST_INVALID",
});

export const TURN_LIFECYCLE_REJECTION_ERROR = "TurnLifecycleRejectedError";

export function createTurnLifecycleRejectedError(reason) {
  if (!isCanonicalText(reason)) throw new TypeError("turn lifecycle rejection reason is required");
  const error = new Error(reason);
  error.name = TURN_LIFECYCLE_REJECTION_ERROR;
  error.code = reason;
  return error;
}

export function isTurnLifecycleRejectedError(error) {
  return error instanceof Error && error.name === TURN_LIFECYCLE_REJECTION_ERROR;
}

export const SESSION_DELETED_REASON = "session_deleted";
export const SESSION_NOT_FOUND_REASON = "session_not_found";

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

export function createSessionNotFoundError({ userId = "", sessionId = "" } = {}) {
  const normalizedSessionId = text(sessionId);
  const error = new Error(`session not found: ${normalizedSessionId}`);
  error.statusCode = 404;
  error.code = SESSION_ERROR_CODE.SESSION_NOT_FOUND;
  error.userId = text(userId);
  error.sessionId = normalizedSessionId;
  return error;
}

export function isSessionNotFoundError(error) {
  return error?.code === SESSION_ERROR_CODE.SESSION_NOT_FOUND;
}

export function assertSessionScopeIdentity({ session, sessionId, parentSessionId }) {
  if (session?.sessionId === sessionId && session?.parentSessionId === parentSessionId) return;
  const error = new Error(`session identity conflicts with its storage scope: ${text(sessionId)}`);
  error.statusCode = 409;
  error.code = SESSION_ERROR_CODE.SCOPE_IDENTITY_CONFLICT;
  error.sessionId = text(sessionId);
  throw error;
}
