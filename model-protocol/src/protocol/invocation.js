/* Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import { requireModelContextSequencePolicy } from "../policy/context-policy.js";
import { isPlainObject } from "@noobot/shared/value";
import { MODEL_ERROR_KIND, MODEL_ATTEMPT_KIND } from "./constants.js";
import { ModelProtocolError } from "./error.js";

const MODEL_ERROR_KINDS = new Set(Object.values(MODEL_ERROR_KIND));

function requireClassificationError(kind, value) {
  if (kind === MODEL_ERROR_KIND.CLASSIFICATION ? typeof value !== "string" : value !== null) {
    throw new TypeError(
      "classificationError must describe a classification failure, otherwise be null",
    );
  }
  return value;
}

function freezeClassification(kind, retryable, classificationError = null) {
  return Object.freeze({ kind, retryable, classificationError });
}

export function classifyModelFailure(error, classify) {
  if (error instanceof ModelProtocolError) {
    return freezeClassification(error.kind, error.retryable);
  }
  try {
    const classification = classify(error);
    if (!MODEL_ERROR_KINDS.has(classification?.kind)) {
      throw new TypeError("model error classification.kind must be a MODEL_ERROR_KIND");
    }
    if (classification.kind === MODEL_ERROR_KIND.CLASSIFICATION) {
      throw new TypeError("adapter classification must not declare classification kind");
    }
    if (typeof classification.retryable !== "boolean") {
      throw new TypeError("model error classification.retryable must be boolean");
    }
    return freezeClassification(classification.kind, classification.retryable);
  } catch (classificationError) {
    return freezeClassification(
      MODEL_ERROR_KIND.CLASSIFICATION,
      false,
      String(classificationError?.message ?? classificationError),
    );
  }
}

export function projectModelAttemptError({
  message,
  code,
  kind,
  retryable,
  classificationError,
} = {}) {
  if (typeof message !== "string") {
    throw new TypeError("model attempt error message must be text");
  }
  if (code !== null && (typeof code !== "string" || !code)) {
    throw new TypeError("model attempt error code must be non-empty text or null");
  }
  if (!MODEL_ERROR_KINDS.has(kind)) {
    throw new TypeError("model attempt error kind must be a MODEL_ERROR_KIND");
  }
  if (typeof retryable !== "boolean") {
    throw new TypeError("model attempt error retryable must be boolean");
  }
  requireClassificationError(kind, classificationError);
  return Object.freeze({ message, code, kind, retryable, classificationError });
}

export function projectModelInvocationFailure({
  attemptCount,
  message,
  code,
  kind,
  failedAttempts,
  classificationError = null,
} = {}) {
  if (!Number.isInteger(attemptCount) || attemptCount < 0) {
    throw new TypeError("model invocation failure attemptCount must be a non-negative integer");
  }
  if (typeof message !== "string") {
    throw new TypeError("model invocation failure message must be text");
  }
  if (code !== null && (typeof code !== "string" || !code)) {
    throw new TypeError("model invocation failure code must be non-empty text or null");
  }
  if (typeof kind !== "string" || !kind) {
    throw new TypeError("model invocation failure kind must be non-empty text");
  }
  requireClassificationError(kind, classificationError);
  if (!Array.isArray(failedAttempts)) {
    throw new TypeError("model invocation failure failedAttempts must be an array");
  }
  let previousAttempt = 0;
  const projectedAttempts = failedAttempts.map((attempt) => {
    if (
      !Number.isInteger(attempt?.attempt) ||
      attempt.attempt <= previousAttempt ||
      attempt.attempt > attemptCount
    ) {
      throw new TypeError("failed model attempt number must be within invocation attemptCount");
    }
    previousAttempt = attempt.attempt;
    if (!Object.values(MODEL_ATTEMPT_KIND).includes(attempt.kind)) {
      throw new TypeError("failed model attempt kind must be non-empty text");
    }
    return Object.freeze({
      attempt: attempt.attempt,
      kind: attempt.kind,
      error: projectModelAttemptError(attempt.error),
    });
  });
  return Object.freeze({
    attemptCount,
    message,
    code,
    kind,
    classificationError,
    failedAttempts: Object.freeze(projectedAttempts),
  });
}

const INVOCATION_SCOPE_REQUIRED_FIELDS = Object.freeze([
  "sessionId",
  "dialogProcessId",
  "turnScopeId",
  "runId",
]);
const INVOCATION_CALL_FIELDS = Object.freeze([
  "requestId",
  "invocationId",
  "flow",
  "purpose",
  "domain",
]);

function requireCanonicalFields(input, fields, label) {
  for (const key of fields) {
    const value = input[key];
    if (typeof value !== "string" || !value || value !== value.trim())
      throw new TypeError(`${label}.${key} must be canonical non-empty text`);
  }
}

export function requireInvocationScope(input, label) {
  if (!isPlainObject(input)) throw new TypeError(`${label} must be an object`);
  requireCanonicalFields(input, INVOCATION_SCOPE_REQUIRED_FIELDS, label);
  const { parentSessionId } = input;
  if (typeof parentSessionId !== "string" || parentSessionId !== parentSessionId.trim())
    throw new TypeError(`${label}.parentSessionId must be canonical text`);
  return Object.freeze({
    sessionId: input.sessionId,
    parentSessionId,
    dialogProcessId: input.dialogProcessId,
    turnScopeId: input.turnScopeId,
    runId: input.runId,
  });
}

export function requireInvocationIdentity(input) {
  const scope = requireInvocationScope(input, "model invocation");
  requireCanonicalFields(input, INVOCATION_CALL_FIELDS, "model invocation");
  return Object.freeze({
    requestId: input.requestId,
    invocationId: input.invocationId,
    ...scope,
    flow: input.flow,
    purpose: input.purpose,
    domain: input.domain,
    contextSequencePolicy: requireModelContextSequencePolicy(input.contextSequencePolicy),
  });
}
