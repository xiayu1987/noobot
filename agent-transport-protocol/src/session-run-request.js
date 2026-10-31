/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { validateSessionPersistenceScope } from "@noobot/session-protocol";
import { isCanonicalText, isPlainObject } from "@noobot/shared/value";

const SESSION_RUN_PAYLOAD_FIELDS = Object.freeze([
  "userId",
  "sessionId",
  "message",
  "attachments",
  "systemMessages",
  "eventListener",
  "caller",
  "parentSessionId",
  "parentDialogProcessId",
  "dialogProcessId",
  "abortSignal",
  "userInteractionBridge",
  "userInterjectionPort",
  "runConfig",
  "turnAcceptance",
  "turnScopeId",
  "persistenceScope",
]);

export function assertSessionRunRequest(payload) {
  if (!isPlainObject(payload)) {
    throw new TypeError("session run payload must be a plain object");
  }
  const missing = SESSION_RUN_PAYLOAD_FIELDS.filter((field) => !Object.hasOwn(payload, field));
  if (missing.length) {
    throw new TypeError(`session run payload requires: ${missing.join(",")}`);
  }
  const unknown = Object.keys(payload).filter(
    (field) => !SESSION_RUN_PAYLOAD_FIELDS.includes(field),
  );
  if (unknown.length) {
    throw new TypeError(`session run payload has unknown fields: ${unknown.join(",")}`);
  }
  for (const field of ["attachments", "systemMessages"]) {
    if (!Array.isArray(payload[field])) {
      throw new TypeError(`session run payload ${field} must be an array`);
    }
  }
  if (!isPlainObject(payload.runConfig)) {
    throw new TypeError("session run payload runConfig must be a plain object");
  }
  if (!isCanonicalText(payload.turnScopeId)) {
    throw new TypeError("session run payload turnScopeId must be canonical text");
  }
  for (const field of ["parentDialogProcessId", "dialogProcessId"]) {
    if (payload[field] !== "" && !isCanonicalText(payload[field])) {
      throw new TypeError(`session run payload ${field} must be empty or canonical text`);
    }
  }
  if (typeof payload.parentSessionId !== "string") {
    throw new TypeError("session run parentSessionId must be a string");
  }
  const persistenceScopeValidation = validateSessionPersistenceScope(payload.persistenceScope);
  if (!persistenceScopeValidation.valid) {
    throw new TypeError(
      `invalid Session persistence scope: ${persistenceScopeValidation.errors.join(",")}`,
    );
  }
  return payload;
}
