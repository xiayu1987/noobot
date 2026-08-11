/*
 * Copyright (c) 2026 xiayu
 * Contact: 126240622+xiayu1987@users.noreply.github.com
 * SPDX-License-Identifier: MIT
 */
import {
  MODEL_PROTOCOL_NAME,
  MODEL_PROTOCOL_VERSION,
  MODEL_REQUEST_STATUS,
} from "../protocol/constants.js";
import { requireInvocationIdentity } from "../protocol/invocation.js";
import { MODEL_OPERATION_KIND, normalizeModelOperationResult } from "../protocol/operation.js";

const RESPONSE_KEYS = Object.freeze([
  "protocol",
  "protocolVersion",
  "status",
  "operationKind",
  "invocation",
  "output",
  "result",
  "execution",
]);
const OUTPUT_KEYS = Object.freeze(["text", "reasoning", "toolCalls", "finishReason", "usage"]);
const EXECUTION_KEYS = Object.freeze(["attemptCount", "attempts", "model", "provider"]);
const ATTEMPT_KEYS = Object.freeze(["attempt", "status", "kind", "streaming", "output", "error"]);
const ATTEMPT_STATUSES = new Set(["completed", "retry", "failed"]);

function requirePlainObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function rejectUnknownKeys(value, allowedKeys, path) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new TypeError(`${path} contains unsupported fields: ${unknown.join(", ")}`);
}

function validateOutput(value, path = "model response.output") {
  const output = requirePlainObject(value, path);
  rejectUnknownKeys(output, OUTPUT_KEYS, path);
  for (const key of ["text", "reasoning", "finishReason"]) {
    if (typeof output[key] !== "string") throw new TypeError(`${path}.${key} must be a string`);
  }
  if (!Array.isArray(output.toolCalls)) throw new TypeError(`${path}.toolCalls must be an array`);
  requirePlainObject(output.usage, `${path}.usage`);
  return output;
}

function validateAttempt(value, index) {
  const path = `model response.execution.attempts[${index}]`;
  const attempt = requirePlainObject(value, path);
  rejectUnknownKeys(attempt, ATTEMPT_KEYS, path);
  if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
    throw new TypeError(`${path}.attempt must be a positive integer`);
  }
  if (!ATTEMPT_STATUSES.has(attempt.status)) throw new TypeError(`${path}.status is invalid`);
  if (!String(attempt.kind || "").trim()) throw new TypeError(`${path}.kind is required`);
  if (typeof attempt.streaming !== "boolean")
    throw new TypeError(`${path}.streaming must be a boolean`);
  if (attempt.output !== undefined) validateOutput(attempt.output, `${path}.output`);
  if (attempt.error !== undefined) requirePlainObject(attempt.error, `${path}.error`);
  if (attempt.status === "completed" && attempt.output === undefined) {
    throw new TypeError(`${path}.output is required for a completed attempt`);
  }
  if (attempt.status === "failed" && attempt.output === undefined && attempt.error === undefined) {
    throw new TypeError(`${path} requires output or error for a failed attempt`);
  }
  return attempt;
}

export function validateModelResponse(input) {
  const response = requirePlainObject(input, "model response");
  rejectUnknownKeys(response, RESPONSE_KEYS, "model response");
  if (response.protocol !== MODEL_PROTOCOL_NAME)
    throw new TypeError("invalid model response protocol");
  if (response.protocolVersion !== MODEL_PROTOCOL_VERSION) {
    throw new TypeError(`unsupported model response protocol version: ${response.protocolVersion}`);
  }
  if (response.status !== MODEL_REQUEST_STATUS.COMPLETED) {
    throw new TypeError(`invalid model response status: ${response.status}`);
  }
  requireInvocationIdentity(response.invocation);
  if (!Object.values(MODEL_OPERATION_KIND).includes(response.operationKind)) {
    throw new TypeError(`invalid model response operation kind: ${response.operationKind || "missing"}`);
  }
  validateOutput(response.output);
  normalizeModelOperationResult(response.operationKind, response.result);
  const execution = requirePlainObject(response.execution, "model response.execution");
  rejectUnknownKeys(execution, EXECUTION_KEYS, "model response.execution");
  if (!Number.isInteger(execution.attemptCount) || execution.attemptCount < 1) {
    throw new TypeError("model response.execution.attemptCount must be a positive integer");
  }
  if (!Array.isArray(execution.attempts) || execution.attempts.length < 1) {
    throw new TypeError("model response.execution.attempts must be a non-empty array");
  }
  execution.attempts.forEach(validateAttempt);
  if (execution.attemptCount !== execution.attempts.length) {
    throw new TypeError("model response.execution.attemptCount must equal attempts.length");
  }
  requirePlainObject(execution.model, "model response.execution.model");
  requirePlainObject(execution.provider, "model response.execution.provider");
  return response;
}
