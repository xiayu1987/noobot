/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text, isPlainObject } from "@noobot/shared/value";

const SESSION_PERSISTENCE_SCOPE_FIELDS = Object.freeze([
  "scopeId",
  "parentSessionId",
  "relativeDir",
  "allowedRoot",
]);

export function validateSessionPersistenceScope(source) {
  if (source === null) return { valid: true, errors: [], scope: null };
  if (source === undefined) {
    return { valid: false, errors: ["missing_persistence_scope"], scope: null };
  }
  if (!isPlainObject(source)) {
    return { valid: false, errors: ["invalid_persistence_scope"], scope: null };
  }
  const scope = Object.freeze(
    Object.fromEntries(
      SESSION_PERSISTENCE_SCOPE_FIELDS.map((field) => [field, text(source[field])]),
    ),
  );
  const errors = [];
  if (Object.keys(source).some((key) => !SESSION_PERSISTENCE_SCOPE_FIELDS.includes(key))) {
    errors.push("unknown_persistence_scope_field");
  }
  if (SESSION_PERSISTENCE_SCOPE_FIELDS.some((field) => !scope[field])) {
    errors.push("incomplete_persistence_scope");
  }
  return { valid: errors.length === 0, errors, scope: errors.length === 0 ? scope : null };
}

export function createSessionPersistenceScope(source) {
  const validation = validateSessionPersistenceScope(source);
  if (!validation.valid) {
    const error = new TypeError(
      `invalid Session persistence scope: ${validation.errors.join(",")}`,
    );
    error.code = "SESSION_PERSISTENCE_SCOPE_INVALID";
    error.details = { errors: validation.errors };
    throw error;
  }
  return validation.scope;
}
