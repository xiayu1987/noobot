/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { isPlainObject } from "@noobot/shared/value";
import { requireDialogProcessKey } from "./identity.js";
import { MESSAGE_DIAGNOSTIC_SOURCE } from "./message-diagnostic-source.js";
export {
  MESSAGE_DIAGNOSTIC_SOURCE,
  messageDiagnosticSourceId,
} from "./message-diagnostic-source.js";
import {
  prepareExecutionLogRecord,
  EXECUTION_LOG_BATCH_MAX_RECORDS,
} from "./aggregate/execution-event-index.js";

export const MESSAGE_DIAGNOSTIC_PROJECTION_DIRECTORY = "message-diagnostics";
export const MESSAGE_DIAGNOSTIC_CURSOR_FILE = "cursor.json";

export function messageDiagnosticKey(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 1)
    throw new TypeError("Message diagnostic requires a positive source sequence");
  return String(sequence).padStart(16, "0");
}

export function messageDiagnosticTurnKey(dialogProcessId, sequence) {
  requireDialogProcessKey(dialogProcessId);
  if (sequence === undefined) return JSON.stringify(["turn", dialogProcessId]);
  return JSON.stringify(["turn", dialogProcessId, messageDiagnosticKey(sequence)]);
}

export function requireMessageDiagnosticCursor(cursor) {
  if (
    !isPlainObject(cursor) ||
    Object.keys(cursor).length !== 2 ||
    cursor.version !== 1 ||
    !Number.isSafeInteger(cursor.sequence) ||
    cursor.sequence < 0
  )
    throw new TypeError("Invalid message diagnostic cursor");
  return cursor;
}

export function requireMessageDiagnosticPageRequest({ after, limit }) {
  requireMessageDiagnosticCursor({ version: 1, sequence: after });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > EXECUTION_LOG_BATCH_MAX_RECORDS)
    throw new TypeError("Message diagnostic page exceeds its record budget");
}

export function requireMessageDiagnostics(diagnostics, messages) {
  if (!Array.isArray(diagnostics)) throw new TypeError("Message diagnostics must be an array");
  const sources = new Map(messages.map((message) => [message.messageUid, message]));
  const seen = new Set();
  for (const diagnostic of diagnostics) {
    if (
      !isPlainObject(diagnostic) ||
      Object.keys(diagnostic).length !== 2 ||
      !Object.hasOwn(diagnostic, "messageUid") ||
      !Object.hasOwn(diagnostic, "record")
    )
      throw new TypeError("Message diagnostic requires its message UID and record");
    const { messageUid, record } = diagnostic;
    const message = sources.get(messageUid);
    if (!message || seen.has(messageUid))
      throw new TypeError("Message diagnostic requires one changed full message source");
    seen.add(messageUid);
    prepareExecutionLogRecord(record);
    if (
      record.event !== "session_turn_full" ||
      record.dialogProcessId !== message.dialogProcessId ||
      record.turnScopeId !== message.turnScopeId ||
      record.sessionId !== message.sessionId ||
      record.data?.artifactRef?.source !== MESSAGE_DIAGNOSTIC_SOURCE ||
      record.data?.artifactRef?.messageUid !== messageUid
    )
      throw new TypeError("Message diagnostic source ownership mismatch");
  }
  return diagnostics;
}
