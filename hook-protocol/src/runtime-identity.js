/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */

import { isCanonicalText, isPlainObject } from "@noobot/shared/value";
import { requireSessionCaller } from "@noobot/shared/session-caller";

export const HOOK_RUNTIME_IDENTITY_FIELDS = Object.freeze([
  "userId",
  "sessionId",
  "parentSessionId",
  "dialogProcessId",
  "turnScopeId",
  "caller",
]);

const REQUIRED_TEXT_FIELDS = Object.freeze([
  "userId",
  "sessionId",
  "dialogProcessId",
  "turnScopeId",
]);

function identityError(message, details) {
  const error = new TypeError(message);
  error.code = "HOOK_RUNTIME_IDENTITY_INVALID";
  error.details = details;
  return error;
}

export function createHookRuntimeIdentity(identity) {
  if (!isPlainObject(identity)) {
    throw identityError("hook runtime identity must be a plain object", { identity });
  }
  const unknown = Object.keys(identity).filter(
    (field) => !HOOK_RUNTIME_IDENTITY_FIELDS.includes(field),
  );
  if (unknown.length) {
    throw identityError(`hook runtime identity has unknown fields: ${unknown.join(",")}`, {
      unknown,
    });
  }
  for (const field of REQUIRED_TEXT_FIELDS) {
    if (!isCanonicalText(identity[field])) {
      throw identityError(`hook runtime identity ${field} must be canonical text`, {
        field,
        value: identity[field],
      });
    }
  }
  const { parentSessionId } = identity;
  if (typeof parentSessionId !== "string" || parentSessionId !== parentSessionId.trim()) {
    throw identityError("hook runtime identity parentSessionId must be canonical string", {
      field: "parentSessionId",
      value: parentSessionId,
    });
  }
  return Object.freeze({
    userId: identity.userId,
    sessionId: identity.sessionId,
    parentSessionId,
    dialogProcessId: identity.dialogProcessId,
    turnScopeId: identity.turnScopeId,
    caller: requireSessionCaller(identity.caller),
  });
}

export function assertNoHookRuntimeIdentityFields(value, label) {
  if (!isPlainObject(value)) {
    throw identityError(`${label} must be a plain object`, { [label]: value });
  }
  const conflicts = HOOK_RUNTIME_IDENTITY_FIELDS.filter((field) => Object.hasOwn(value, field));
  if (conflicts.length) {
    throw identityError(`${label} must not carry identity fields: ${conflicts.join(",")}`, {
      conflicts,
    });
  }
  return value;
}

export function withHookRuntimeIdentity(identity, context) {
  assertNoHookRuntimeIdentityFields(context, "hook context");
  return { ...context, ...createHookRuntimeIdentity(identity) };
}
