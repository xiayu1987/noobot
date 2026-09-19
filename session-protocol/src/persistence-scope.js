/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { text } from "./normalize.js";

export const SESSION_PERSISTENCE_SCOPE_FIELDS = Object.freeze([
  "scopeId",
  "parentSessionId",
  "relativeDir",
  "allowedRoot",
]);

export function createSessionPersistenceScope(source = null) {
  if (source == null) return null;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return Object.freeze({});
  }
  return Object.freeze(
    Object.fromEntries(
      SESSION_PERSISTENCE_SCOPE_FIELDS.map((field) => [field, text(source[field])]),
    ),
  );
}

export function validateSessionPersistenceScope(source = null) {
  if (source == null) return { valid: true, errors: [], scope: null };
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { valid: false, errors: ["invalid_persistence_scope"], scope: null };
  }
  const scope = createSessionPersistenceScope(source);
  const errors = [];
  if (Object.keys(source).some((key) => !SESSION_PERSISTENCE_SCOPE_FIELDS.includes(key))) {
    errors.push("unknown_persistence_scope_field");
  }
  if (SESSION_PERSISTENCE_SCOPE_FIELDS.some((field) => !scope[field])) {
    errors.push("incomplete_persistence_scope");
  }
  return { valid: errors.length === 0, errors, scope };
}
